'use strict';

/**
 * Strict Zone & Director Data Isolation Gateways (01-architecture.md, 03-director-chat.md, 04-security.md)
 *
 * Architectural Guarantees:
 * 1. Raw `players` table is NEVER accessible to ANY AI zone OR Director!
 *    Zones read ONLY anonymized SQL projections (`v_balance_players`, `v_fraud_players`, `v_market_players`).
 * 2. Zones CANNOT read `director_chat`, `ai_zone_configs`, or cross-zone `zone_summaries`.
 *    Each zone accesses ONLY its own summary history via `readOwnSummaryHistory()`.
 * 3. `IsolatedDirectorGateway` reads ONLY `zone_summaries`, `director_state`, `director_chat`,
 *    `action_proposals`, `incidents`, and `ab_experiments` — ZERO raw telemetry or PII!
 */

const crypto = require('node:crypto');
const { ROLES } = require('../config');

class ZoneIsolationError extends Error {
  constructor(role, attemptedResource, reason) {
    super(`[ZoneIsolationError] Role '${role}' denied access to '${attemptedResource}': ${reason}`);
    this.name = 'ZoneIsolationError';
    this.code = 'ZONE_ISOLATION_VIOLATION';
    this.role = role;
    this.attemptedResource = attemptedResource;
  }
}

const ZONE_ALLOWED_TABLES = Object.freeze({
  ops: new Set(['sessions', 'telemetry_metrics', 'input_events', 'incidents']),
  fraud: new Set(['fraud_cases', 'sessions', 'input_events', 'payments', 'v_fraud_players']),
  balance: new Set(['input_events', 'match_rules_versions', 'v_balance_players']),
  market: new Set([
    'marketing_campaigns',
    'payments',
    'ad_events',
    'economy_ledger',
    'v_market_players',
    'sessions',
  ]),
  lab: new Set(['lab_runs', 'ab_experiments', 'match_rules_versions']),
});

const DIRECTOR_ALLOWED_TABLES = Object.freeze(
  new Set([
    'zone_summaries',
    'director_state',
    'director_chat',
    'action_proposals',
    'incidents',
    'ab_experiments',
  ])
);

function extractReferencedTables(sql) {
  const normalized = String(sql)
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .toLowerCase();
  const tables = new Set();
  const re = /\b(?:from|join|into|update|table)\s+([a-z0-9_]+)/g;
  let m;
  while ((m = re.exec(normalized)) !== null) {
    tables.add(m[1]);
  }
  return { normalized, tables: [...tables] };
}

function assertZoneReadSql(zone, sql) {
  const allowed = ZONE_ALLOWED_TABLES[zone];
  if (!allowed) {
    throw new ZoneIsolationError(`ai_zone_${zone}`, 'unknown_zone', 'Unknown AI zone');
  }
  const { normalized, tables } = extractReferencedTables(sql);
  if (!/^\s*(select|with)\b/.test(normalized)) {
    throw new ZoneIsolationError(`ai_zone_${zone}`, normalized.slice(0, 40), 'AI zone query must be SELECT-only');
  }
  for (const tbl of tables) {
    if (tbl === 'players') {
      throw new ZoneIsolationError(
        `ai_zone_${zone}`,
        'players',
        'Direct access to raw PII table `players` is forbidden; use anonymized SQL view'
      );
    }
    if (tbl === 'director_chat' || tbl === 'zone_summaries' || tbl === 'ai_zone_configs') {
      throw new ZoneIsolationError(
        `ai_zone_${zone}`,
        tbl,
        'Zones cannot access Director chat, cross-zone summaries, or zone configs (01-architecture.md)'
      );
    }
    if (!allowed.has(tbl)) {
      throw new ZoneIsolationError(
        `ai_zone_${zone}`,
        tbl,
        `Table '${tbl}' is outside isolated boundary of zone '${zone}'`
      );
    }
  }
}

function assertDirectorReadSql(sql) {
  const { normalized, tables } = extractReferencedTables(sql);
  if (!/^\s*(select|with)\b/.test(normalized)) {
    throw new ZoneIsolationError(ROLES.AI_DIRECTOR, normalized.slice(0, 40), 'Director query must be SELECT-only');
  }
  for (const tbl of tables) {
    if (!DIRECTOR_ALLOWED_TABLES.has(tbl)) {
      throw new ZoneIsolationError(
        ROLES.AI_DIRECTOR,
        tbl,
        `Director is strictly forbidden from reading raw table '${tbl}' (03-director-chat.md)`
      );
    }
  }
}

class IsolatedZoneGateway {
  constructor(db, zone) {
    if (!ZONE_ALLOWED_TABLES[zone]) {
      throw new Error(`Invalid zone '${zone}'`);
    }
    this.db = db;
    this.zone = zone;
    this.role = `ai_zone_${zone}`;
  }

  queryAll(sql, ...params) {
    assertZoneReadSql(this.zone, sql);
    return this.db.prepare(sql).all(...params);
  }

  queryGet(sql, ...params) {
    assertZoneReadSql(this.zone, sql);
    return this.db.prepare(sql).get(...params);
  }

  readOwnSummaryHistory(limit = 5) {
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
    return this.db
      .prepare('SELECT id, zone, status, summary_json, created_at FROM zone_summaries WHERE zone = ? ORDER BY created_at DESC LIMIT ?')
      .all(this.zone, safeLimit)
      .map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, summary: JSON.parse(r.summary_json) }));
  }

  writeSummary({ status, summaryObj, requestId = null }) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO zone_summaries (id, zone, status, summary_json, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, this.zone, status, JSON.stringify(summaryObj), requestId, createdAt);
    return id;
  }
}

class IsolatedDirectorGateway {
  constructor(db) {
    this.db = db;
    this.role = ROLES.AI_DIRECTOR;
  }

  queryAll(sql, ...params) {
    assertDirectorReadSql(sql);
    return this.db.prepare(sql).all(...params);
  }

  queryGet(sql, ...params) {
    assertDirectorReadSql(sql);
    return this.db.prepare(sql).get(...params);
  }
}

module.exports = {
  ZoneIsolationError,
  ZONE_ALLOWED_TABLES,
  DIRECTOR_ALLOWED_TABLES,
  IsolatedZoneGateway,
  IsolatedDirectorGateway,
  assertZoneReadSql,
  assertDirectorReadSql,
};
