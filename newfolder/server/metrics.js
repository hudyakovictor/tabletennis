/* ─────────────────────────────────────────────────────────────────────────────
 * Агрегаты для дашбордов, AI-зон, бота и алертов.
 * Всё считается из нормализованных таблиц; сырые JSONL директору не отдаются.
 * ─────────────────────────────────────────────────────────────────────────── */
import { rangeStart, round, pct, avg, safeJSON, fillSeries, percentile, clamp, nowISO, sum } from './util.js';

const q = (db, sql, ...p) => db.prepare(sql).all(...p);
const one = (db, sql, ...p) => db.prepare(sql).get(...p);
const n = (v) => Number(v) || 0;
const p = (a, b) => b > 0 ? round(a / b * 100, 2) : 0;
const r = (v, d = 2) => round(v, d);

function delta(cur, prev) {
  const c = n(cur), v = n(prev);
  if (!v) return c ? 100 : 0;
  return r((c - v) / Math.abs(v) * 100, 1);
}

export function rangeBounds(range = '7d', now = Date.now()) {
  const days = { '1h': 1, '24h': 1, '48h': 2, '7d': 7, '14d': 14, '30d': 30, '90d': 90, 'all': 365 }[range] || 7;
  const from = rangeStart(range, now);
  const prevFrom = new Date(Date.parse(from) - days * 86400e3).toISOString();
  return { from, prevFrom, to: nowISO(now), days };
}

/* ── Обзор ────────────────────────────────────────────────────────────────── */
export function overview(db, range = '7d') {
  const b = rangeBounds(range);
  const cur = one(db, `SELECT
    (SELECT COUNT(DISTINCT player_id) FROM game_sessions WHERE started_at>=?) AS players,
    (SELECT COUNT(*) FROM game_sessions WHERE started_at>=?) AS sessions,
    (SELECT COALESCE(SUM(amount_usd),0) FROM payments WHERE ts>=? AND status='paid' AND refunded=0) AS revenue,
    (SELECT AVG(fps_avg) FROM game_sessions WHERE started_at>=? AND fps_avg IS NOT NULL) AS fps,
    (SELECT COUNT(*) FROM ops_crashes WHERE ts>=?) AS crashes,
    (SELECT COUNT(*) FROM alerts WHERE ts>=? AND status!='resolved') AS open_alerts,
    (SELECT COUNT(*) FROM fraud_cases WHERE ts>=? AND status='open') AS fraud_cases,
    (SELECT COUNT(*) FROM tickets WHERE ts>=? AND status IN ('new','in_progress')) AS tickets,
    (SELECT COUNT(*) FROM proposals WHERE ts>=? AND status='pending') AS proposals,
    (SELECT COUNT(*) FROM input_logs WHERE ts>=?) AS inputs,
    (SELECT COUNT(*) FROM input_logs WHERE ts>=? AND accepted=0) AS rejected`,
  b.from, b.from, b.from, b.from, b.from, b.from, b.from, b.from, b.from, b.from, b.from);
  const prev = one(db, `SELECT
    (SELECT COUNT(DISTINCT player_id) FROM game_sessions WHERE started_at>=? AND started_at<?) AS players,
    (SELECT COUNT(*) FROM game_sessions WHERE started_at>=? AND started_at<?) AS sessions,
    (SELECT COALESCE(SUM(amount_usd),0) FROM payments WHERE ts>=? AND ts<? AND status='paid' AND refunded=0) AS revenue,
    (SELECT AVG(fps_avg) FROM game_sessions WHERE started_at>=? AND started_at<? AND fps_avg IS NOT NULL) AS fps`,
  b.prevFrom, b.from, b.prevFrom, b.from, b.prevFrom, b.from, b.prevFrom, b.from);
  const daily = q(db, `SELECT substr(started_at,1,10) AS day, COUNT(*) AS sessions,
    COUNT(DISTINCT player_id) AS dau FROM game_sessions WHERE started_at>=? GROUP BY day ORDER BY day`, b.from);
  const revDaily = q(db, `SELECT substr(ts,1,10) AS day, SUM(amount_usd) AS revenue FROM payments
    WHERE ts>=? AND status='paid' AND refunded=0 GROUP BY day ORDER BY day`, b.from);
  const rejectSeries = q(db, `SELECT substr(ts,1,10) AS day,
    SUM(CASE WHEN accepted=0 THEN 1 ELSE 0 END)*1.0/COUNT(*) AS rate
    FROM input_logs WHERE ts>=? GROUP BY day ORDER BY day`, b.from);
  const kpis = [
    { key: 'players', label: 'Активные игроки', value: n(cur.players), delta: delta(cur.players, prev.players), unit: '' },
    { key: 'sessions', label: 'Сессии', value: n(cur.sessions), delta: delta(cur.sessions, prev.sessions), unit: '' },
    { key: 'revenue', label: 'Выручка', value: r(cur.revenue), delta: delta(cur.revenue, prev.revenue), unit: '$' },
    { key: 'fps', label: 'Средний FPS', value: r(cur.fps, 1), delta: delta(cur.fps, prev.fps), unit: '' },
    { key: 'crashes', label: 'Крэши', value: n(cur.crashes), delta: null, unit: '' },
    { key: 'reject_rate', label: 'Отказы ввода', value: p(cur.rejected, cur.inputs), delta: null, unit: '%' },
    { key: 'alerts', label: 'Открытые алерты', value: n(cur.open_alerts), delta: null, unit: '' },
    { key: 'fraud', label: 'Fraud-кейсы', value: n(cur.fraud_cases), delta: null, unit: '' },
  ];
  return {
    range, from: b.from, to: b.to, kpis,
    charts: {
      sessions: fillSeries(daily.map(d => ({ day: d.day, value: d.sessions })), b.from, b.days),
      dau: fillSeries(daily.map(d => ({ day: d.day, value: d.dau })), b.from, b.days),
      revenue: fillSeries(revDaily.map(d => ({ day: d.day, value: r(d.revenue) })), b.from, b.days),
      reject_rate: fillSeries(rejectSeries.map(d => ({ day: d.day, value: r(d.rate * 100, 1) })), b.from, b.days),
    },
    alerts: q(db, `SELECT * FROM alerts WHERE status!='resolved' ORDER BY
      CASE level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, ts DESC LIMIT 8`),
    zoneStatus: q(db, `SELECT z.zone, z.status, z.ts, z.metrics, z.findings FROM zone_summaries z
      WHERE z.id = (SELECT id FROM zone_summaries z2 WHERE z2.zone=z.zone ORDER BY ts DESC LIMIT 1)`),
    openIncidents: q(db, `SELECT * FROM incidents WHERE status='open' ORDER BY ts DESC LIMIT 5`),
    pendingProposals: n(cur.proposals),
    openTickets: n(cur.tickets),
  };
}

/* ── Ops: четыре золотых сигнала ─────────────────────────────────────────── */
export function ops(db, range = '24h') {
  const b = rangeBounds(range);
  const latency = q(db, `SELECT latency_ms FROM ops_http WHERE ts>=? AND latency_ms IS NOT NULL ORDER BY latency_ms`, b.from)
    .map(x => n(x.latency_ms));
  const errors = q(db, `SELECT code, level, SUM(occurrences) AS n FROM ops_errors WHERE ts>=? GROUP BY code, level ORDER BY n DESC LIMIT 20`, b.from);
  const httpByDay = q(db, `SELECT substr(ts,1,10) AS day,
    COUNT(*) AS requests, SUM(CASE WHEN status>=500 THEN 1 ELSE 0 END) AS e5xx,
    AVG(latency_ms) AS avg_ms FROM ops_http WHERE ts>=? GROUP BY day ORDER BY day`, b.from);
  const perf = one(db, `SELECT AVG(fps) AS fps, AVG(frame_ms) AS frame_ms, AVG(update_ms) AS update_ms,
    AVG(render_ms) AS render_ms, AVG(ui_ms) AS ui_ms, AVG(long_task_ms) AS long_task_ms,
    AVG(ping_ms) AS ping_ms FROM ops_perf WHERE ts>=?`, b.from);
  const sessions = one(db, `SELECT COUNT(*) AS sessions, SUM(crash) AS crashes,
    AVG(duration_s) AS avg_duration, AVG(fps_avg) AS fps FROM game_sessions WHERE started_at>=?`, b.from);
  const rejects = q(db, `SELECT COALESCE(reject_code,'accepted') AS code, COUNT(*) AS n FROM input_logs
    WHERE ts>=? GROUP BY reject_code ORDER BY n DESC`, b.from);
  const builds = q(db, `SELECT COALESCE(build_version,'unknown') AS build, COUNT(*) AS sessions,
    SUM(crash) AS crashes FROM game_sessions WHERE started_at>=? GROUP BY build ORDER BY sessions DESC`, b.from);
  const pings = q(db, `SELECT region, AVG(ping_ms) AS ping_ms, COUNT(*) AS samples, MAX(ts) AS last_ts
    FROM ops_pings WHERE ts>=? GROUP BY region ORDER BY ping_ms`, b.from);
  const devices = q(db, `SELECT COALESCE(device_type,'unknown') AS device, COUNT(*) AS n,
    AVG(fps_avg) AS fps FROM game_sessions WHERE started_at>=? GROUP BY device ORDER BY n DESC`, b.from);
  const totalHttp = n(one(db, 'SELECT COUNT(*) AS n FROM ops_http WHERE ts>=?', b.from).n);
  const e5xx = n(one(db, 'SELECT COUNT(*) AS n FROM ops_http WHERE ts>=? AND status>=500', b.from).n);
  const crashRate = p(sessions.crashes, sessions.sessions);
  return {
    range, from: b.from,
    golden: {
      latency: { p50: r(percentile(latency, 50), 1), p95: r(percentile(latency, 95), 1), p99: r(percentile(latency, 99), 1) },
      traffic: { rps: r(totalHttp / Math.max(1, b.days * 86400), 3), requests: totalHttp, sessions: n(sessions.sessions) },
      errors: { rate_5xx: p(e5xx, totalHttp), total: e5xx, crashes: n(sessions.crashes), crash_rate: crashRate },
      saturation: { avg_frame_ms: r(perf.frame_ms, 2), long_task_ms: r(perf.long_task_ms, 1), avg_ping_ms: r(perf.ping_ms, 1) },
    },
    perf: Object.fromEntries(Object.entries(perf || {}).map(([k, v]) => [k, r(v, 2)])),
    sessions: { ...Object.fromEntries(Object.entries(sessions || {}).map(([k, v]) => [k, r(v, 2)])), crash_rate: crashRate },
    charts: {
      requests: fillSeries(httpByDay.map(d => ({ day: d.day, value: d.requests })), b.from, b.days),
      errors: fillSeries(httpByDay.map(d => ({ day: d.day, value: d.e5xx })), b.from, b.days),
      latency: fillSeries(httpByDay.map(d => ({ day: d.day, value: r(d.avg_ms, 1) })), b.from, b.days),
    },
    errors, rejects, builds, pings, devices,
    alerts: q(db, `SELECT * FROM alerts WHERE zone='ops' ORDER BY ts DESC LIMIT 20`),
  };
}

/* ── Balance: отказы ввода, теплокарта, сегменты ─────────────────────────── */
export function balance(db, range = '7d', filters = {}) {
  const b = rangeBounds(range);
  const where = ['ts>=?']; const args = [b.from];
  if (filters.rules_version) { where.push('rules_version=?'); args.push(String(filters.rules_version)); }
  if (filters.device_type) { where.push('device_type=?'); args.push(String(filters.device_type)); }
  if (filters.pointer_type) { where.push('pointer_type=?'); args.push(String(filters.pointer_type)); }
  if (filters.build_version) { where.push('build_version=?'); args.push(String(filters.build_version)); }
  const W = where.join(' AND ');
  const totals = one(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN accepted=0 THEN 1 ELSE 0 END) AS rejected,
    AVG(timing_error_ms) AS timing, AVG(distance_px) AS distance, AVG(direction_dot) AS direction
    FROM input_logs WHERE ${W}`, ...args);
  const byCode = q(db, `SELECT COALESCE(reject_code,'accepted') AS code, COUNT(*) AS n FROM input_logs
    WHERE ${W} GROUP BY reject_code ORDER BY n DESC`, ...args);
  const bySegment = q(db, `SELECT COALESCE(device_type,'unknown') AS device,
    COALESCE(pointer_type,'unknown') AS pointer, COALESCE(rules_version,'?') AS rules,
    COALESCE(hand,'unknown') AS hand, COUNT(*) AS n,
    SUM(CASE WHEN accepted=0 THEN 1 ELSE 0 END) AS rejected
    FROM input_logs WHERE ${W} GROUP BY device,pointer,rules,hand ORDER BY n DESC LIMIT 40`, ...args)
    .map(x => ({ ...x, reject_rate: p(x.rejected, x.n) }));
  const byBuild = q(db, `SELECT COALESCE(build_version,'unknown') AS build, COUNT(*) AS n,
    SUM(CASE WHEN accepted=0 THEN 1 ELSE 0 END) AS rejected FROM input_logs
    WHERE ${W} GROUP BY build ORDER BY n DESC`, ...args).map(x => ({ ...x, reject_rate: p(x.rejected, x.n) }));
  const bySpeed = q(db, `SELECT CAST(ball_speed/2 AS INT)*2 AS speed_bucket, COUNT(*) AS n,
    SUM(CASE WHEN accepted=0 THEN 1 ELSE 0 END) AS rejected FROM input_logs
    WHERE ${W} AND ball_speed IS NOT NULL GROUP BY speed_bucket ORDER BY speed_bucket`, ...args)
    .map(x => ({ ...x, reject_rate: p(x.rejected, x.n) }));
  // Теплокарта along/across только по ОТКАЗАМ: где игроки промахиваются.
  const CELLS = 12;
  const heatRows = q(db, `SELECT along, across FROM input_logs WHERE ${W} AND accepted=0
    AND along IS NOT NULL AND across IS NOT NULL`, ...args);
  const heat = Array.from({ length: CELLS }, () => Array(CELLS).fill(0));
  for (const row of heatRows) {
    const ix = clamp(Math.floor((n(row.along) + 100) / 200 * CELLS), 0, CELLS - 1);
    const iy = clamp(Math.floor((n(row.across) + 100) / 200 * CELLS), 0, CELLS - 1);
    heat[iy][ix]++;
  }
  const series = q(db, `SELECT substr(ts,1,10) AS day,
    SUM(CASE WHEN accepted=0 THEN 1 ELSE 0 END)*1.0/COUNT(*) AS rate, COUNT(*) AS n
    FROM input_logs WHERE ${W} GROUP BY day ORDER BY day`, ...args);
  const worst = bySegment.slice().sort((a, b2) => b2.reject_rate - a.reject_rate).filter(x => x.n >= 20).slice(0, 5);
  return {
    range, filters, from: b.from,
    totals: { attempts: n(totals.n), rejected: n(totals.rejected),
      reject_rate: p(totals.rejected, totals.n), success_rate: r(100 - p(totals.rejected, totals.n), 2),
      timing_error_ms: r(totals.timing, 1), distance_px: r(totals.distance, 1), direction_dot: r(totals.direction, 3) },
    byCode: byCode.map(x => ({ ...x, share: p(x.n, totals.n) })),
    bySegment, byBuild, bySpeed, worst,
    heatmap: { cells: heat, axis: { along: [-100, 100], across: [-100, 100] }, size: CELLS, max: Math.max(1, ...heat.flat()) },
    charts: { reject_rate: fillSeries(series.map(d => ({ day: d.day, value: r(d.rate * 100, 1) })), b.from, b.days) },
    summaries: latestSummaries(db, 'balance'),
  };
}

/* ── Market: каналы, когорты, retention, ROAS ────────────────────────────── */
export function retention(db, range = '30d') {
  const b = rangeBounds(range);
  const players = q(db, `SELECT id, channel, install_at FROM players WHERE install_at>=?`, b.from);
  const days = q(db, `SELECT DISTINCT player_id, substr(started_at,1,10) AS day FROM game_sessions WHERE started_at>=?`, b.from);
  const byPlayer = new Map();
  for (const d of days) {
    if (!byPlayer.has(d.player_id)) byPlayer.set(d.player_id, new Set());
    byPlayer.get(d.player_id).add(d.day);
  }
  const cohorts = {};
  for (const p of players) {
    const day = String(p.install_at).slice(0, 10);
    if (!cohorts[day]) cohorts[day] = { cohort: day, size: 0, d1: 0, d7: 0, d30: 0, channel: {} };
    const c = cohorts[day]; c.size++;
    c.channel[p.channel] = (c.channel[p.channel] || 0) + 1;
    const set = byPlayer.get(p.id) || new Set();
    const t0 = Date.parse(day + 'T00:00:00Z');
    for (const [k, offset] of [['d1', 1], ['d7', 7], ['d30', 30]]) {
      const target = new Date(t0 + offset * 86400e3).toISOString().slice(0, 10);
      if (set.has(target)) c[k]++;
    }
  }
  const rows = Object.values(cohorts).sort((a, b2) => a.cohort.localeCompare(b2.cohort)).slice(-14)
    .map(c => ({ ...c, d1_pct: p(c.d1, c.size), d7_pct: p(c.d7, c.size), d30_pct: p(c.d30, c.size) }));
  const overall = ['d1', 'd7', 'd30'].map(k => {
    const valid = rows.filter(c => Date.parse(c.cohort) < Date.now() - ({ d1: 2, d7: 8, d30: 31 }[k]) * 86400e3);
    return { key: k, value: p(sum(valid.map(c => c[k])), sum(valid.map(c => c.size))) };
  });
  return { cohorts: rows, overall: Object.fromEntries(overall.map(x => [x.key, x.value])) };
}

export function market(db, range = '30d') {
  const b = rangeBounds(range);
  const installs = q(db, `SELECT channel, campaign, COUNT(*) AS players,
    SUM(ltv_usd) AS revenue, SUM(CASE WHEN ltv_usd>0 THEN 1 ELSE 0 END) AS payers
    FROM players WHERE install_at>=? GROUP BY channel, campaign ORDER BY players DESC`, b.from);
  const costs = q(db, `SELECT channel, SUM(cost_usd) AS cost, SUM(installs) AS installs,
    SUM(impressions) AS impressions, SUM(clicks) AS clicks FROM market_events
    WHERE ts>=? GROUP BY channel`, b.from);
  const costMap = Object.fromEntries(costs.map(c => [c.channel, c]));
  const ret = retention(db, range);
  const channels = installs.map(i => {
    const c = costMap[i.channel] || {};
    return {
      channel: i.channel, campaign: i.campaign, players: n(i.players),
      spend: r(c.cost || 0), installs: n(c.installs), impressions: n(c.impressions), clicks: n(c.clicks),
      cpi: r((c.cost || 0) / Math.max(1, n(c.installs)), 3),
      cac: r((c.cost || 0) / Math.max(1, n(i.players)), 3),
      payers: n(i.payers), conversion: p(i.payers, i.players),
      revenue: r(i.revenue), ltv: r(i.revenue / Math.max(1, n(i.players)), 3),
      arppu: r(i.revenue / Math.max(1, n(i.payers)), 2),
      roas: r(i.revenue / Math.max(0.01, c.cost || 0), 3),
      ecpm: r((c.cost || 0) / Math.max(1, n(c.impressions)) * 1000, 2),
      d1: ret.overall.d1, d7: ret.overall.d7, d30: ret.overall.d30,
    };
  });
  const dau = q(db, `SELECT substr(started_at,1,10) AS day, COUNT(DISTINCT player_id) AS dau
    FROM game_sessions WHERE started_at>=? GROUP BY day ORDER BY day`, b.from);
  const mau = n(one(db, 'SELECT COUNT(DISTINCT player_id) AS n FROM game_sessions WHERE started_at>=?', b.from).n);
  const revenue = n(one(db, `SELECT COALESCE(SUM(amount_usd),0) AS n FROM payments WHERE ts>=? AND status='paid' AND refunded=0`, b.from).n);
  const payers = n(one(db, `SELECT COUNT(DISTINCT player_id) AS n FROM payments WHERE ts>=? AND status='paid' AND refunded=0`, b.from).n);
  const activePlayers = n(one(db, 'SELECT COUNT(DISTINCT player_id) AS n FROM game_sessions WHERE started_at>=?', b.from).n);
  const campaigns = q(db, `SELECT campaign, channel, COUNT(*) AS players, SUM(ltv_usd) AS revenue
    FROM players WHERE install_at>=? GROUP BY campaign, channel ORDER BY players DESC LIMIT 20`, b.from);
  const creatives = q(db, `SELECT creative, channel, COUNT(*) AS players, SUM(ltv_usd) AS revenue
    FROM players WHERE install_at>=? GROUP BY creative, channel ORDER BY players DESC LIMIT 20`, b.from);
  const revDaily = q(db, `SELECT substr(ts,1,10) AS day, SUM(amount_usd) AS revenue FROM payments
    WHERE ts>=? AND status='paid' AND refunded=0 GROUP BY day ORDER BY day`, b.from);
  const spend = sum(costs.map(c => n(c.cost)));
  return {
    range, from: b.from, channels, campaigns, creatives, retention: ret,
    totals: {
      spend: r(spend), revenue: r(revenue), roas: r(revenue / Math.max(0.01, spend), 3),
      dau: n(dau.at(-1)?.dau), mau, sticky: p(dau.at(-1)?.dau, mau),
      arpu: r(revenue / Math.max(1, activePlayers), 3), arppu: r(revenue / Math.max(1, payers), 2),
      arpdau: r(revenue / Math.max(1, sum(dau.map(d => n(d.dau)))) * 1, 3),
      ltv: r(revenue / Math.max(1, activePlayers), 3), payer_conversion: p(payers, activePlayers),
      ecpm: r(spend / Math.max(1, sum(costs.map(c => n(c.impressions)))) * 1000, 2),
    },
    charts: {
      dau: fillSeries(dau.map(d => ({ day: d.day, value: d.dau })), b.from, b.days),
      revenue: fillSeries(revDaily.map(d => ({ day: d.day, value: r(d.revenue) })), b.from, b.days),
    },
    summaries: latestSummaries(db, 'market'),
  };
}

/* ── Экономика ────────────────────────────────────────────────────────────── */
export function economy(db, range = '30d') {
  const b = rangeBounds(range);
  const totals = one(db, `SELECT COUNT(*) AS payments, SUM(amount_usd) AS revenue,
    SUM(refunded) AS refunds, SUM(chargeback) AS chargebacks,
    COUNT(DISTINCT player_id) AS payers FROM payments WHERE ts>=? AND status='paid'`, b.from);
  const products = q(db, `SELECT product_id, product_kind, COUNT(*) AS n, SUM(amount_usd) AS revenue
    FROM payments WHERE ts>=? AND status='paid' GROUP BY product_id, product_kind ORDER BY revenue DESC`, b.from);
  const byRegion = q(db, `SELECT region, COUNT(*) AS n, SUM(amount_usd) AS revenue FROM payments
    WHERE ts>=? AND status='paid' GROUP BY region ORDER BY revenue DESC`, b.from);
  const flows = q(db, `SELECT currency, kind, SUM(amount) AS amount, COUNT(*) AS n FROM economy_events
    WHERE ts>=? GROUP BY currency, kind ORDER BY currency, kind`, b.from);
  const daily = q(db, `SELECT substr(ts,1,10) AS day, SUM(amount_usd) AS revenue, COUNT(*) AS n
    FROM payments WHERE ts>=? AND status='paid' GROUP BY day ORDER BY day`, b.from);
  return {
    range, from: b.from,
    totals: { ...Object.fromEntries(Object.entries(totals || {}).map(([k, v]) => [k, r(v, 2)])), refund_rate: p(totals.refunds, totals.payments) },
    products, byRegion, flows,
    charts: { revenue: fillSeries(daily.map(d => ({ day: d.day, value: r(d.revenue) })), b.from, b.days),
      payments: fillSeries(daily.map(d => ({ day: d.day, value: d.n })), b.from, b.days) },
  };
}

/* ── Игроки ───────────────────────────────────────────────────────────────── */
export function playersList(db, { search = '', region = '', status = '', sort = 'created_at', dir = 'DESC', limit = 50, offset = 0 } = {}) {
  const where = ['1=1']; const args = [];
  if (search) { where.push('(id LIKE ? OR display_name LIKE ? OR telegram_id LIKE ?)'); args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (region) { where.push('region=?'); args.push(region); }
  if (status) { where.push('status=?'); args.push(status); }
  const allowed = ['created_at', 'ltv_usd', 'risk_score', 'install_at', 'region', 'status'];
  const col = allowed.includes(sort) ? sort : 'created_at';
  const d = String(dir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const total = one(db, `SELECT COUNT(*) AS n FROM players WHERE ${where.join(' AND ')}`, ...args).n;
  const rows = q(db, `SELECT * FROM players WHERE ${where.join(' AND ')} ORDER BY ${col} ${d} LIMIT ? OFFSET ?`,
    ...args, Math.min(200, Number(limit) || 50), Math.max(0, Number(offset) || 0));
  return { total, rows, limit: Number(limit) || 50, offset: Number(offset) || 0 };
}

export function playerDetail(db, id) {
  const player = one(db, 'SELECT * FROM players WHERE id=?', id);
  if (!player) return null;
  const sessions = q(db, 'SELECT * FROM game_sessions WHERE player_id=? ORDER BY started_at DESC LIMIT 20', id);
  const payments = q(db, 'SELECT * FROM payments WHERE player_id=? ORDER BY ts DESC LIMIT 30', id);
  const consents = q(db, 'SELECT * FROM consents WHERE player_id=? ORDER BY ts DESC LIMIT 5', id);
  const tickets = q(db, 'SELECT * FROM tickets WHERE player_id=? ORDER BY ts DESC LIMIT 10', id);
  const fraud = q(db, 'SELECT * FROM fraud_cases WHERE player_id=? ORDER BY ts DESC LIMIT 10', id);
  const input = one(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN accepted=0 THEN 1 ELSE 0 END) AS rejected,
    AVG(timing_error_ms) AS timing FROM input_logs WHERE player_id=?`, id);
  return {
    player, sessions, payments, consents, tickets, fraud,
    input: { attempts: n(input.n), rejected: n(input.rejected), reject_rate: p(input.rejected, input.n), timing_error_ms: r(input.timing, 1) },
    deletionRequests: q(db, 'SELECT * FROM deletion_requests WHERE player_id=? ORDER BY ts DESC', id),
  };
}

/* ── Fraud ────────────────────────────────────────────────────────────────── */
export function fraudMetrics(db, range = '7d') {
  const b = rangeBounds(range);
  const cases = q(db, `SELECT c.*, p.display_name, p.channel, p.status AS player_status FROM fraud_cases c
    LEFT JOIN players p ON p.id=c.player_id WHERE c.ts>=? ORDER BY c.risk_score DESC LIMIT 100`, b.from)
    .map(c => ({ ...c, reasons: safeJSON(c.reasons, []), signals: safeJSON(c.signals, []) }));
  const totals = one(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open,
    SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN status='false_positive' THEN 1 ELSE 0 END) AS false_positive,
    AVG(risk_score) AS avg_risk FROM fraud_cases WHERE ts>=?`, b.from);
  const signals = q(db, `SELECT signal, COUNT(*) AS n, AVG(value) AS avg_value
    FROM fraud_signals WHERE ts>=? GROUP BY signal ORDER BY n DESC`, b.from);
  const histogram = [0, 0, 0, 0, 0];
  for (const c of cases) histogram[clamp(Math.floor(n(c.risk_score) * 5), 0, 4)]++;
  return {
    range, from: b.from, cases, signals, histogram,
    totals: { ...Object.fromEntries(Object.entries(totals || {}).map(([k, v]) => [k, r(v, 2)])),
      players_high_risk: n(one(db, 'SELECT COUNT(*) AS n FROM players WHERE risk_score>=0.7').n) },
    summaries: latestSummaries(db, 'fraud'),
  };
}

/* ── Lab ──────────────────────────────────────────────────────────────────── */
export function labMetrics(db, range = '30d') {
  const b = rangeBounds(range);
  const tests = q(db, 'SELECT * FROM lab_tests ORDER BY ts DESC LIMIT 50')
    .map(t => ({ ...t, variants: safeJSON(t.variants, []), metrics: safeJSON(t.metrics, []) }));
  const testIds = tests.map(t => t.id);
  const results = testIds.length
    ? q(db, `SELECT * FROM lab_results WHERE test_id IN (${testIds.map(() => '?').join(',')}) ORDER BY ts`, ...testIds)
    : [];
  return {
    range, from: b.from, tests, results,
    runs: q(db, 'SELECT * FROM lab_test_runs WHERE ts>=? ORDER BY ts DESC LIMIT 30', b.from)
      .map(x => ({ ...x, payload: safeJSON(x.payload, x.payload) })),
    reports: q(db, 'SELECT * FROM lab_reports WHERE ts>=? ORDER BY ts DESC LIMIT 30', b.from)
      .map(x => ({ ...x, payload: safeJSON(x.payload, x.payload) })),
    summaries: latestSummaries(db, 'lab'),
  };
}

/* ── ИИ ───────────────────────────────────────────────────────────────────── */
export function aiMetrics(db, cfg, range = '7d') {
  const b = rangeBounds(range);
  const day = new Date().toISOString().slice(0, 10);
  const requests = q(db, `SELECT zone, provider, COUNT(*) AS n, SUM(prompt_tokens) AS tin,
    SUM(completion_tokens) AS tout, SUM(cost_usd) AS cost, AVG(latency_ms) AS latency,
    SUM(CASE WHEN status!='ok' THEN 1 ELSE 0 END) AS errors
    FROM ai_requests WHERE ts>=? GROUP BY zone, provider ORDER BY n DESC`, b.from);
  const used = Object.fromEntries(q(db, 'SELECT zone, tokens FROM ai_limits WHERE day=?', day).map(x => [x.zone, x.tokens]));
  const zones = cfg.aiZones.map(z => ({
    zone: z, model: cfg.ai[z].model,
    provider: cfg.ai[z].apiKey ? 'openai-compatible' : 'local-heuristic',
    configured: !!cfg.ai[z].apiKey,
    dailyLimit: cfg.ai[z].dailyTokens, usedToday: n(used[z]),
    usagePct: p(used[z], cfg.ai[z].dailyTokens),
    requests: n(requests.filter(x => x.zone === z).reduce((a, x) => a + n(x.n), 0)),
    cost: r(requests.filter(x => x.zone === z).reduce((a, x) => a + n(x.cost), 0), 4),
    lastSummary: latestSummaries(db, z)[0] || null,
    cadenceMinutes: cfg.ai[z].cadenceMinutes,
  }));
  return {
    range, from: b.from, zones, requests,
    totals: {
      requests: n(one(db, 'SELECT COUNT(*) AS n FROM ai_requests WHERE ts>=?', b.from).n),
      tokens: n(one(db, 'SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) AS n FROM ai_requests WHERE ts>=?', b.from).n),
      cost: r(one(db, 'SELECT COALESCE(SUM(cost_usd),0) AS n FROM ai_requests WHERE ts>=?', b.from).n, 4),
      quarantined: n(one(db, 'SELECT COUNT(*) AS n FROM ai_quarantine WHERE ts>=? AND resolved=0', b.from).n),
    },
    recentRequests: q(db, 'SELECT * FROM ai_requests ORDER BY ts DESC LIMIT 30'),
    quarantine: q(db, 'SELECT * FROM ai_quarantine ORDER BY ts DESC LIMIT 30'),
  };
}

export function latestSummaries(db, zone, limit = 5) {
  return q(db, 'SELECT * FROM zone_summaries WHERE zone=? ORDER BY ts DESC LIMIT ?', zone, limit)
    .map(s => ({ ...s, findings: safeJSON(s.findings, []), metrics: safeJSON(s.metrics, {}) }));
}

export function allLatestSummaries(db) {
  const out = {};
  for (const zone of ['ops', 'fraud', 'balance', 'market', 'lab']) out[zone] = latestSummaries(db, zone, 1)[0] || null;
  return out;
}

/* ── Сводка для Telegram-бота / ежедневного дайджеста ────────────────────── */
export function botSnapshot(db, cfg) {
  const o = overview(db, '24h');
  const opsD = ops(db, '24h');
  const fr = fraudMetrics(db, '7d');
  const aiD = aiMetrics(db, cfg, '24h');
  const pings = q(db, `SELECT region, AVG(ping_ms) AS ping FROM ops_pings
    WHERE ts>=? GROUP BY region ORDER BY region`, rangeBounds('24h').from);
  return {
    status: o.kpis, alerts: o.alerts, golden: opsD.golden,
    errors: opsD.errors, pings, fraud: fr.totals, ai: aiD.totals,
    openIncidents: o.openIncidents, maintenance: false,
  };
}
