/* Детекторы алертов (14-observability-runbooks.md).
 * Пороги настраиваются в settings.alert_thresholds. Дедупликация не даёт
 * завалить владельца одинаковыми алертами. Алерт ничего не меняет в игре. */
import { insert, getSetting, updateRow } from './db.js';
import { ops, balance, overview } from './metrics.js';
import { uuid, nowISO, iso, round } from './util.js';

export const RUNBOOKS = {
  INPUT_REJECT_SPIKE: 'runbooks/input-reject-spike.md',
  CRASH_RATE: 'runbooks/crashes.md',
  P95_LATENCY: 'runbooks/latency.md',
  ERROR_5XX: 'runbooks/errors.md',
  DAU_DROP: 'runbooks/dau-drop.md',
  LOW_FPS: 'runbooks/performance.md',
  AI_PROVIDER: 'runbooks/ai-provider.md',
  FRAUD_SPIKE: 'runbooks/fraud-spike.md',
  TICKET_SPIKE: 'runbooks/ticket-spike.md',
};

export function createAlert(db, { level = 'warning', zone = 'ops', code, title, message = '', metrics = {}, source = 'detector', dedupeMinutes = 60 }) {
  const since = iso(Date.now() - dedupeMinutes * 60e3);
  const existing = db.prepare(`SELECT id FROM alerts WHERE code=? AND status!='resolved' AND ts>=?`).get(code, since);
  if (existing) return { created: false, id: existing.id };
  const id = uuid();
  insert(db, 'alerts', {
    id, ts: nowISO(), level, zone, code, title, message,
    status: 'open', runbook: RUNBOOKS[code] || 'runbooks/general.md',
    metrics: JSON.stringify(metrics), source,
  });
  return { created: true, id };
}

export function evaluateAlerts(db) {
  const thresholds = getSetting(db, 'alert_thresholds', {});
  const created = [];
  const d = ops(db, '24h');
  const b = balance(db, '24h');
  const o24 = overview(db, '24h');
  const add = (result) => { if (result.created) created.push(result.id); };

  if (b.totals.attempts >= 20 && b.totals.reject_rate > (thresholds.reject_rate_pct ?? 40)) {
    add(createAlert(db, {
      level: b.totals.reject_rate > 55 ? 'critical' : 'warning', zone: 'ops', code: 'INPUT_REJECT_SPIKE',
      title: 'Всплеск отказов ввода',
      message: `Reject rate ${b.totals.reject_rate}% при ${b.totals.attempts} попытках за 24 часа.`,
      metrics: { reject_rate: b.totals.reject_rate, attempts: b.totals.attempts, threshold: thresholds.reject_rate_pct ?? 40 },
    }));
  }
  if (d.sessions.sessions >= 5 && d.golden.errors.crash_rate > (thresholds.crash_rate_pct ?? 3)) {
    add(createAlert(db, {
      level: 'critical', zone: 'ops', code: 'CRASH_RATE', title: 'Рост crash rate',
      message: `Crash rate ${d.golden.errors.crash_rate}% (${d.golden.errors.crashes} крэшей).`,
      metrics: d.golden.errors,
    }));
  }
  if (d.golden.traffic.requests >= 10 && d.golden.latency.p95 > (thresholds.p95_latency_ms ?? 500)) {
    add(createAlert(db, {
      level: 'warning', zone: 'ops', code: 'P95_LATENCY', title: 'P95 latency выше порога',
      message: `p95=${d.golden.latency.p95} мс, p99=${d.golden.latency.p99} мс.`,
      metrics: d.golden.latency,
    }));
  }
  if (d.golden.traffic.requests >= 10 && d.golden.errors.rate_5xx > (thresholds.error_5xx_pct ?? 5)) {
    add(createAlert(db, {
      level: 'critical', zone: 'ops', code: 'ERROR_5XX', title: 'Рост ошибок 5xx',
      message: `${d.golden.errors.rate_5xx}% запросов завершились 5xx.`,
      metrics: d.golden.errors,
    }));
  }
  const fps = Number(d.sessions.fps) || 0;
  if (d.sessions.sessions >= 5 && fps > 0 && fps < (thresholds.fps_min ?? 40)) {
    add(createAlert(db, {
      level: 'warning', zone: 'ops', code: 'LOW_FPS', title: 'Низкий средний FPS',
      message: `Средний FPS ${round(fps, 1)} ниже порога ${thresholds.fps_min ?? 40}.`,
      metrics: { fps, sessions: d.sessions.sessions },
    }));
  }
  const playersNow = o24.kpis.find(k => k.key === 'players');
  if (playersNow && playersNow.delta < -(thresholds.dau_drop_pct ?? 20) && Number(playersNow.value) >= 0) {
    add(createAlert(db, {
      level: 'warning', zone: 'market', code: 'DAU_DROP', title: 'Падение активных игроков',
      message: `Активные игроки изменились на ${playersNow.delta}% к предыдущему периоду.`,
      metrics: playersNow,
    }));
  }
  const recentTickets = db.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE ts>=?`).get(iso(Date.now() - 3600e3)).n;
  if (recentTickets >= 10) add(createAlert(db, {
    level: 'warning', zone: 'ops', code: 'TICKET_SPIKE', title: 'Всплеск обращений в поддержку',
    message: `${recentTickets} тикетов за последний час. Проверить совпадение с known issues.`,
    metrics: { tickets_1h: recentTickets },
  }));
  const quarantined = db.prepare(`SELECT COUNT(*) AS n FROM ai_quarantine WHERE resolved=0 AND ts>=?`).get(iso(Date.now() - 3600e3)).n;
  if (quarantined) add(createAlert(db, {
    level: 'warning', zone: 'ops', code: 'AI_PROVIDER', title: 'Ответ ИИ отправлен в карантин',
    message: `${quarantined} невалидных ответов за час. Проверить провайдера и prompt injection.`,
    metrics: { quarantined },
  }));
  return { created, count: created.length, evaluated_at: nowISO() };
}

export function setAlertStatus(db, id, status, actor = 'owner') {
  if (!['open', 'ack', 'resolved'].includes(status)) throw Object.assign(new Error('invalid status'), { status: 400 });
  const patch = { status };
  if (status === 'ack') Object.assign(patch, { acked_by: actor, acked_at: nowISO() });
  if (status === 'resolved') Object.assign(patch, { resolved_at: nowISO() });
  updateRow(db, 'alerts', id, patch);
  return db.prepare('SELECT * FROM alerts WHERE id=?').get(id);
}
