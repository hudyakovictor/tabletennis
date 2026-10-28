'use strict';

/**
 * Cadence Engine (02-ai-zones.md).
 *
 * The spec assigns explicit rhythms — Ops «почти реальное время», Fraud
 * «near-realtime», Balance daily/after-release, Market daily, Lab nightly batch —
 * but the previous build only ran zones when a human clicked a button. This module
 * makes the documented cadences real, while adding the four properties that keep an
 * automated AI loop safe and affordable:
 *
 *  1. **No overlap** — a long-running zone can never be started twice in parallel.
 *  2. **No spend on unchanged data** — each zone declares a cheap data fingerprint;
 *     if nothing changed since the last run, the run is skipped, not billed.
 *  3. **Budget-aware** — a zone above 90% of its daily token cap is skipped instead
 *     of being silently starved mid-day (07-ai-providers.md).
 *  4. **Backoff + isolation** — one failing job never blocks the others; failures
 *     back off exponentially and raise exactly one deduplicated notification.
 */

const crypto = require('node:crypto');
const { publish } = require('./eventBus');
const { notify } = require('./notifications');
const { verifyAuditChain } = require('../security/audit');
const { pruneNotifications } = require('./notifications');

const RUNNING = new Set();

function nextAligned(now, cadenceSec) {
  // Align daily jobs to a wall-clock minute instead of drifting from boot time.
  const base = new Date(now.getTime() + cadenceSec * 1000);
  if (cadenceSec >= 3600) {
    base.setUTCMinutes(0, 0, 0);
  }
  return base.toISOString();
}

function nextAtForCadence(cadenceSec, utcHour = null, now = new Date()) {
  if (utcHour !== null && cadenceSec >= 86400) {
    const candidate = new Date(now);
    candidate.setUTCHours(utcHour, 0, 0, 0);
    if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate.toISOString();
  }
  return nextAligned(now, cadenceSec);
}

function zoneBudgetOk(db, zone) {
  try {
    const { getZoneDailyUsage, getZoneRuntimeConfig } = require('../ai/providers');
    const cfg = getZoneRuntimeConfig(db, zone);
    const usage = getZoneDailyUsage(db, zone);
    if (!cfg.enabled) return { ok: false, reason: 'zone_disabled' };
    const used = Number(usage.usedTokens || 0);
    if (used >= cfg.dailyTokenLimit * 0.9) {
      return { ok: false, reason: 'token_budget_guard', used, limit: cfg.dailyTokenLimit };
    }
    return { ok: true, used, limit: cfg.dailyTokenLimit };
  } catch {
    return { ok: true };
  }
}

function dataFingerprint(db, zone) {
  const scalar = (sql) => {
    try {
      const row = db.prepare(sql).get();
      return Object.values(row || {})[0] ?? 0;
    } catch {
      return 0;
    }
  };
  switch (zone) {
    case 'ops':
      return `${scalar('SELECT COUNT(*) FROM sessions')}:${scalar('SELECT COUNT(*) FROM telemetry_metrics')}:${scalar('SELECT COALESCE(MAX(created_at),"") FROM incidents')}`;
    case 'fraud':
      return `${scalar('SELECT COUNT(*) FROM payments')}:${scalar('SELECT COUNT(*) FROM sessions')}:${scalar('SELECT COUNT(*) FROM input_events')}`;
    case 'balance':
      return `${scalar('SELECT COUNT(*) FROM input_events')}:${scalar('SELECT COALESCE(MAX(version),0) FROM match_rules_versions')}`;
    case 'market':
      return `${scalar('SELECT COUNT(*) FROM payments')}:${scalar('SELECT COUNT(*) FROM ad_events')}:${scalar('SELECT COUNT(*) FROM marketing_campaigns')}`;
    case 'lab':
      return `${scalar('SELECT COUNT(*) FROM lab_runs')}:${scalar('SELECT COUNT(*) FROM ab_experiments')}`;
    default:
      return String(Date.now());
  }
}

function zoneHandler(zone) {
  return async (db) => {
    const modules = {
      ops: () => require('../ai/zones/opsZone').runOpsZoneAnalysis,
      fraud: () => require('../ai/zones/fraudZone').runFraudZoneAnalysis,
      balance: () => require('../ai/zones/balanceZone').runBalanceZoneAnalysis,
      market: () => require('../ai/zones/marketZone').runMarketZoneAnalysis,
      lab: () => require('../ai/zones/labZone').runLabZoneAnalysis,
    };
    const budget = zoneBudgetOk(db, zone);
    if (!budget.ok) return { status: 'skipped', detail: { reason: budget.reason, ...budget } };
    const runner = modules[zone]();
    const res = await runner(db, { trigger: 'schedule' });
    return {
      status: 'ok',
      detail: {
        summaryId: res?.summaryId || null,
        findings: res?.summary?.findings?.length || 0,
        statusOfSummary: res?.summary?.status || null,
      },
    };
  };
}

function listActiveIncidents(db) {
  try {
    return db.prepare("SELECT * FROM incidents WHERE status != 'resolved'").all();
  } catch {
    return [];
  }
}

const JOBS = Object.freeze([
  {
    name: 'zone_ops',
    zone: 'ops',
    cadenceSec: 15 * 60,
    description: 'Ops: FPS, краши, RTT и аномалии ввода — почти реальное время',
    handler: zoneHandler('ops'),
  },
  {
    name: 'zone_fraud',
    zone: 'fraud',
    cadenceSec: 30 * 60,
    description: 'Fraud: risk score и очередь кейсов — near-realtime, без автобанов',
    handler: zoneHandler('fraud'),
  },
  {
    name: 'zone_balance',
    zone: 'balance',
    cadenceSec: 6 * 3600,
    description: 'Balance: теплокарта овала, 6 зон стола и MATCH_RULES',
    handler: zoneHandler('balance'),
  },
  {
    name: 'zone_market',
    zone: 'market',
    cadenceSec: 24 * 3600,
    utcHour: 8,
    description: 'Market: каналы, когорты, LTV/ROAS — ежедневно 08:00 UTC',
    handler: zoneHandler('market'),
  },
  {
    name: 'zone_lab',
    zone: 'lab',
    cadenceSec: 24 * 3600,
    utcHour: 3,
    description: 'Lab: ночной batch-разбор гипотез и A/B 03:00 UTC',
    handler: zoneHandler('lab'),
  },
  {
    name: 'anomaly_scan',
    cadenceSec: 5 * 60,
    description: 'Детектор аномалий (5xx +50%, p99 > 2σ, всплеск отказов ввода)',
    handler: async (db) => {
      const { evaluateBaselineAnomalies } = require('./observability');
      const anomalies = evaluateBaselineAnomalies(db) || [];
      const actionable = anomalies.filter((a) => a.severity === 'critical' || a.severity === 'warning');
      for (const a of actionable) {
        notify(db, {
          kind: 'anomaly',
          severity: a.severity,
          title: a.title || 'Аномалия метрик',
          body: a.detail || a.description || '',
          link: '#/observability',
          fingerprint: `anomaly:${a.metric || a.title}`,
          dedupeWindowSec: 1800,
          roles: [],
        });
      }
      return {
        status: 'ok',
        detail: { detected: anomalies.length, actionable: actionable.length },
      };
    },
  },
  {
    name: 'ticket_sla_sweep',
    cadenceSec: 10 * 60,
    description: 'SLA поддержки: просроченные первые ответы эскалируются',
    handler: async (db) => {
      const nowIso = new Date().toISOString();
      const overdue = db
        .prepare(
          `SELECT id, subject, priority, sla_due_at, player_id FROM support_tickets
           WHERE status IN ('open', 'in_progress') AND first_response_at IS NULL
             AND sla_due_at IS NOT NULL AND sla_due_at < ?`
        )
        .all(nowIso);
      for (const t of overdue) {
        db.prepare("UPDATE support_tickets SET priority = CASE WHEN priority IN ('low','normal') THEN 'high' ELSE priority END, updated_at = ? WHERE id = ?").run(
          nowIso,
          t.id
        );
        notify(db, {
          kind: 'ticket',
          severity: 'warning',
          title: `SLA поддержки нарушен: ${t.subject}`,
          body: `Тикет ${t.id} без первого ответа, дедлайн ${t.sla_due_at}.`,
          link: '#/liveops?tab=tickets',
          fingerprint: `ticket_sla:${t.id}`,
          dedupeWindowSec: 6 * 3600,
        });
      }
      return { status: 'ok', detail: { overdue: overdue.length } };
    },
  },
  {
    name: 'morning_digest',
    cadenceSec: 24 * 3600,
    utcHour: 6,
    description: 'Утренний дайджест 09:00 МСК (06:00 UTC) для владельца',
    handler: async (db) => {
      const { buildMorningDigest } = require('./telegramBot');
      const digest = buildMorningDigest(db);
      notify(db, {
        kind: 'digest',
        severity: digest.status === 'critical' ? 'critical' : digest.status === 'warning' ? 'warning' : 'info',
        title: 'Утренний дайджест владельца',
        body: digest.summary || digest.headline || 'Сводка дня готова',
        link: '#/overview',
        fingerprint: `digest:${new Date().toISOString().slice(0, 10)}`,
        dedupeWindowSec: 20 * 3600,
      });
      return { status: 'ok', detail: { status: digest.status } };
    },
  },
  {
    name: 'retention_cleanup',
    cadenceSec: 6 * 3600,
    description: 'Политика хранения 90 / 180 / 365 дней и архив чата Директора',
    handler: async (db) => {
      const { runRetentionCleanup } = require('../db/database');
      return { status: 'ok', detail: runRetentionCleanup(db) };
    },
  },
  {
    name: 'session_cleanup',
    cadenceSec: 3600,
    description: 'Удаление просроченных и отозванных админ-сессий',
    handler: async (db) => {
      const { cleanupAdminSessions } = require('../security/auth');
      return { status: 'ok', detail: { deleted: cleanupAdminSessions(db) } };
    },
  },
  {
    name: 'audit_chain_verify',
    cadenceSec: 24 * 3600,
    description: 'Ежедневная проверка целостности hash-chain журнала аудита',
    handler: async (db) => {
      const result = verifyAuditChain(db);
      if (!result.valid) {
        notify(db, {
          kind: 'audit',
          severity: 'critical',
          title: 'Целостность журнала аудита нарушена',
          body: result.message,
          link: '#/governance',
          fingerprint: `audit_chain:${result.brokenAtId}`,
          dedupeWindowSec: 24 * 3600,
        });
      }
      return { status: result.valid ? 'ok' : 'failed', detail: result };
    },
  },
  {
    name: 'db_backup',
    cadenceSec: 24 * 3600,
    utcHour: 2,
    description: 'Ночной горячий бэкап (VACUUM INTO) с проверкой целостности и ротацией',
    handler: async (db) => {
      const { createHotBackup } = require('../db/database');
      const backup = createHotBackup(db);
      if (!backup.ok) {
        notify(db, {
          kind: 'backup',
          severity: 'critical',
          title: 'Бэкап создан, но не прошёл проверку',
          body: `Файл ${backup.backupFile}: integrity=${backup.integrity}, head=${backup.matchesHead ? 'совпадает' : 'не совпадает'}`,
          link: '#/settings?tab=diagnostics',
          fingerprint: `backup_failed:${new Date().toISOString().slice(0, 10)}`,
          dedupeWindowSec: 12 * 3600,
        });
      }
      return {
        status: backup.ok ? 'ok' : 'failed',
        detail: {
          file: backup.backupFile,
          sizeBytes: backup.sizeBytes,
          integrity: backup.integrity,
          matchesHead: backup.matchesHead,
          removed: backup.rotation.removed.length,
        },
      };
    },
  },
  {
    name: 'dsar_sla_sweep',
    cadenceSec: 6 * 3600,
    description: 'Контроль 30-дневного срока запросов субъектов ПДн (эскалация, не удаление)',
    handler: async (db) => {
      const { listPrivacyRequests } = require('./privacy');
      const open = listPrivacyRequests(db, { status: 'open', limit: 500 });
      const overdue = open.filter((r) => r.isOverdue);
      const dueSoon = open.filter((r) => !r.isOverdue && r.daysLeft != null && r.daysLeft <= 5);
      if (overdue.length) {
        notify(db, {
          kind: 'privacy',
          severity: 'critical',
          title: `Просрочено запросов ПДн: ${overdue.length}`,
          body: 'Срок 30 дней истёк — требуется немедленная обработка',
          link: '#/governance?tab=legal',
          fingerprint: `dsar_overdue:${new Date().toISOString().slice(0, 10)}`,
          dedupeWindowSec: 12 * 3600,
        });
      } else if (dueSoon.length) {
        notify(db, {
          kind: 'privacy',
          severity: 'warning',
          title: `Запросы ПДн истекают: ${dueSoon.length}`,
          body: `Ближайший срок — ${dueSoon[0].due_at.slice(0, 10)}`,
          link: '#/governance?tab=legal',
          fingerprint: `dsar_due_soon:${new Date().toISOString().slice(0, 10)}`,
          dedupeWindowSec: 12 * 3600,
        });
      }
      return { status: 'ok', detail: { open: open.length, overdue: overdue.length, dueSoon: dueSoon.length } };
    },
  },
  {
    name: 'notifications_prune',
    cadenceSec: 24 * 3600,
    description: 'Ротация центра уведомлений (прочитанные старше 30 дней)',
    handler: async (db) => ({ status: 'ok', detail: { deleted: pruneNotifications(db, 30) } }),
  },
]);

const JOB_INDEX = new Map(JOBS.map((j) => [j.name, j]));

function ensureJobs(db, now = new Date()) {
  const existing = new Set(db.prepare('SELECT job_name FROM scheduler_jobs').all().map((r) => r.job_name));
  const insert = db.prepare(
    `INSERT INTO scheduler_jobs (job_name, zone, cadence_sec, enabled, next_run_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`
  );
  JOBS.forEach((job, idx) => {
    if (existing.has(job.name)) return;
    // Stagger first executions so a boot never triggers 12 jobs in the same tick.
    const firstRun = new Date(now.getTime() + 20_000 + idx * 7_000);
    insert.run(job.name, job.zone || null, job.cadenceSec, firstRun.toISOString(), now.toISOString());
  });
}

function recordRunStart(db, jobName, trigger) {
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO job_runs (id, job_name, trigger, status, detail_json, started_at)
     VALUES (?, ?, ?, 'running', '{}', ?)`
  ).run(id, jobName, trigger, startedAt);
  return { id, startedAt };
}

function recordRunEnd(db, run, { jobName, status, detail, error = null, durationMs }) {
  const finishedAt = new Date().toISOString();
  db.prepare('UPDATE job_runs SET status = ?, detail_json = ?, finished_at = ?, duration_ms = ? WHERE id = ?').run(
    status,
    JSON.stringify(detail || {}),
    finishedAt,
    Math.round(durationMs),
    run.id
  );
  const row = db.prepare('SELECT * FROM scheduler_jobs WHERE job_name = ?').get(jobName);
  if (!row) return;
  const job = JOB_INDEX.get(jobName);
  const failures = status === 'failed' ? Number(row.consecutive_failures || 0) + 1 : 0;
  const backoffSec = status === 'failed' ? Math.min(job.cadenceSec, 60 * Math.pow(2, failures)) : null;
  const nextRunAt = status === 'failed'
    ? new Date(Date.now() + backoffSec * 1000).toISOString()
    : nextAtForCadence(job.cadenceSec, job.utcHour ?? null);
  db.prepare(
    `UPDATE scheduler_jobs
     SET last_run_at = ?, last_finished_at = ?, last_status = ?, last_duration_ms = ?, last_error = ?,
         next_run_at = ?, consecutive_failures = ?, updated_at = ?
     WHERE job_name = ?`
  ).run(
    run.startedAt,
    finishedAt,
    status,
    Math.round(durationMs),
    error ? String(error).slice(0, 500) : null,
    nextRunAt,
    failures,
    finishedAt,
    jobName
  );

  // Escalation (SRE): a job that fails three times in a row is no longer "a flaky
  // run", it is an outage nobody noticed. Backoff alone is silent by design, so we
  // open exactly one incident per streak and close it on the next success.
  if (status === 'failed' && failures >= 3) escalate(db, jobName, job, error, failures);
  if (status === 'ok' && Number(row.consecutive_failures || 0) >= 3) deescalate(db, jobName);
}

const SCHEDULER_RUNBOOK = 'rb-5xx-spike.md';

function escalate(db, jobName, job, error, failures) {
  const fingerprint = `scheduler_down:${jobName}`;
  const already = db
    .prepare("SELECT id FROM incidents WHERE status != 'resolved' AND title LIKE ? LIMIT 1")
    .get(`%${jobName}%`);
  if (already) return already.id;
  try {
    const { createIncident } = require('./observability');
    const inc = createIncident(db, {
      severity: 'critical',
      zone: 'ops',
      title: `Задача ${jobName} падает ${failures} раз подряд`,
      description: `Джоб «${jobName}» (${job.description || 'без описания'}) не выполняется. Последняя ошибка: ${String(error || 'нет').slice(0, 400)}. Backoff уже применён; требуется ручная проверка.`,
      runbookSlug: SCHEDULER_RUNBOOK,
    });
    notify(db, {
      kind: 'scheduler',
      severity: 'critical',
      title: `Сбой планировщика: ${jobName}`,
      body: `${failures} подряд неудачных запусков`,
      link: '#/settings?tab=scheduler',
      fingerprint,
      dedupeWindowSec: 6 * 3600,
    });
    return inc.id;
  } catch {
    return null;
  }
}

function deescalate(db, jobName) {
  const open = db
    .prepare("SELECT id FROM incidents WHERE status != 'resolved' AND title LIKE ?")
    .all(`%${jobName}%`);
  if (!open.length) return 0;
  const nowIso = new Date().toISOString();
  const stmt = db.prepare("UPDATE incidents SET status = 'resolved', resolved_at = ? WHERE id = ?");
  for (const row of open) stmt.run(nowIso, row.id);
  notify(db, {
    kind: 'scheduler',
    severity: 'info',
    title: `Планировщик восстановлен: ${jobName}`,
    body: `Задача снова выполняется успешно, инцидент закрыт (${open.length})`,
    link: '#/settings?tab=scheduler',
    fingerprint: `scheduler_up:${jobName}`,
    dedupeWindowSec: 3600,
  });
  return open.length;
}

async function runJob(db, jobName, { trigger = 'manual', force = false } = {}) {
  const job = JOB_INDEX.get(jobName);
  if (!job) return { ok: false, error: 'JOB_NOT_FOUND' };
  if (RUNNING.has(jobName)) return { ok: false, error: 'JOB_ALREADY_RUNNING' };

  const state = db.prepare('SELECT * FROM scheduler_jobs WHERE job_name = ?').get(jobName);
  if (state && Number(state.enabled) === 0 && !force) {
    return { ok: true, status: 'skipped', detail: { reason: 'job_disabled' } };
  }

  // Skip unpaid work: unchanged input data since the previous successful run.
  if (job.zone && !force) {
    const fp = dataFingerprint(db, job.zone);
    const lastRun = db
      .prepare("SELECT detail_json FROM job_runs WHERE job_name = ? AND status = 'ok' ORDER BY started_at DESC LIMIT 1")
      .get(jobName);
    let lastFp = null;
    try {
      lastFp = JSON.parse(lastRun?.detail_json || '{}').fingerprint || null;
    } catch {
      lastFp = null;
    }
    if (lastFp && lastFp === fp) {
      // Still persist the fingerprint so the next comparison stays cheap.
      const run = recordRunStart(db, jobName, trigger);
      recordRunEnd(db, run, { jobName, status: 'skipped', detail: { reason: 'no_new_data', fingerprint: fp }, durationMs: 0 });
      publish('job', { job: jobName, status: 'skipped', reason: 'no_new_data' });
      return { ok: true, status: 'skipped', detail: { reason: 'no_new_data' } };
    }
  }

  RUNNING.add(jobName);
  const run = recordRunStart(db, jobName, trigger);
  const started = Date.now();
  try {
    const result = await job.handler(db);
    const status = result?.status === 'skipped' ? 'skipped' : 'ok';
    const detail = { ...(result?.detail || {}) };
    if (job.zone) detail.fingerprint = dataFingerprint(db, job.zone);
    recordRunEnd(db, run, { jobName, status, detail, durationMs: Date.now() - started });
    publish('job', { job: jobName, status, detail: detail.reason || null });
    return { ok: true, status, detail };
  } catch (err) {
    recordRunEnd(db, run, {
      jobName,
      status: 'failed',
      detail: { error: String(err?.message || err) },
      error: err?.message || String(err),
      durationMs: Date.now() - started,
    });
    notify(db, {
      kind: 'system',
      severity: 'critical',
      title: `Задача «${jobName}» завершилась ошибкой`,
      body: String(err?.message || err),
      link: '#/settings?tab=scheduler',
      fingerprint: `job_failure:${jobName}`,
      dedupeWindowSec: 3600,
    });
    publish('job', { job: jobName, status: 'failed', error: String(err?.message || err) });
    return { ok: false, status: 'failed', error: String(err?.message || err) };
  } finally {
    RUNNING.delete(jobName);
  }
}

async function schedulerTick(db, now = new Date()) {
  ensureJobs(db, now);
  const due = db
    .prepare("SELECT job_name FROM scheduler_jobs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT 6")
    .all(now.toISOString());
  const results = [];
  for (const row of due) {
    // eslint-disable-next-line no-await-in-loop
    results.push({ job: row.job_name, ...(await runJob(db, row.job_name, { trigger: 'schedule' })) });
  }
  return results;
}

function schedulerStatus(db) {
  const jobs = db
    .prepare('SELECT * FROM scheduler_jobs ORDER BY next_run_at ASC')
    .all()
    .map((row) => {
      const meta = JOB_INDEX.get(row.job_name);
      return {
        ...row,
        enabled: Boolean(row.enabled),
        description: meta?.description || '',
        cadence_human: humanCadence(row.cadence_sec),
        running: RUNNING.has(row.job_name),
      };
    });
  const recentRuns = db
    .prepare('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 40')
    .all()
    .map((r) => ({ ...r, detail: safeJson(r.detail_json) }));
  const successRate = (() => {
    const rows = db
      .prepare("SELECT status, COUNT(*) AS c FROM job_runs WHERE started_at > ? GROUP BY status")
      .all(new Date(Date.now() - 7 * 86400 * 1000).toISOString());
    const total = rows.reduce((acc, r) => acc + Number(r.c), 0);
    const failed = rows.filter((r) => r.status === 'failed').reduce((acc, r) => acc + Number(r.c), 0);
    return total === 0 ? 100 : Math.round(((total - failed) / total) * 1000) / 10;
  })();
  return { jobs, recentRuns, successRate7d: successRate, schedulerEnabled: CONFIG_SCHEDULER_ENABLED() };
}

function CONFIG_SCHEDULER_ENABLED() {
  return process.env.CRM_SCHEDULER_DISABLED !== '1';
}

function safeJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function humanCadence(sec) {
  const s = Number(sec || 0);
  if (s < 3600) return `${Math.round(s / 60)} мин`;
  if (s < 86400) return `${Math.round(s / 3600)} ч`;
  return `${Math.round(s / 86400)} сут`;
}

function setJobEnabled(db, jobName, enabled) {
  const res = db
    .prepare('UPDATE scheduler_jobs SET enabled = ?, updated_at = ? WHERE job_name = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), jobName);
  return Number(res.changes || 0) > 0;
}

let timer = null;
function startScheduler(db, { intervalMs = 30_000 } = {}) {
  if (timer) return () => {};
  ensureJobs(db);
  const tick = async () => {
    try {
      await schedulerTick(db);
    } catch {
      /* a scheduler tick must never crash the web server */
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    timer = null;
  };
}

module.exports = {
  JOBS,
  ensureJobs,
  runJob,
  schedulerTick,
  schedulerStatus,
  setJobEnabled,
  startScheduler,
  dataFingerprint,
  nextAtForCadence,
};
