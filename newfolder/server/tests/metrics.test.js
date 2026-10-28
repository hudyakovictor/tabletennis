import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, defaultSettings, insert, getSetting } from '../db.js';
import { ingestBatch } from '../ingest.js';
import { validateEvent } from '../events.js';
import { overview, balance, market, retention } from '../metrics.js';
import { scorePlayer, createCaseIfNeeded, reviewCase } from '../fraud.js';
import { createAlert, evaluateAlerts } from '../alerts.js';
import { runRetention } from '../actions.js';
import { loadConfig } from '../config.js';
import { event } from './helpers.js';
import { iso, uuid } from '../util.js';

function fixture() {
  const db = openDb(':memory:', { memory: true });
  defaultSettings(db);
  const events = [event('install', { channel: 'telegram_ads', campaign: 'test' })];
  for (let i = 0; i < 30; i++) events.push(event('input', { accepted: i % 3 ? 1 : 0, reject_code: i % 3 ? null : 'OUTSIDE_ZONE', along: 10 + (i % 2), across: 20, timing_error_ms: 5, ball_speed: 8, pointer_type: 'touch', device_type: 'touch' }, { id: `input-${i}` }));
  events.push(event('session_start', { device_type: 'touch' }, { id: 'session-test' }));
  events.push(event('payment', { amount_usd: 4.99, status: 'paid', product_id: 'pass' }, { id: 'payment-test' }));
  events.push(event('marketing', { channel: 'telegram_ads', cost_usd: 2, installs: 1, impressions: 1000, clicks: 20 }, { id: 'marketing-test', player_id: null }));
  ingestBatch(db, events.map(e => validateEvent(e)));
  return db;
}

test('overview and balance compute real aggregates', () => {
  const db = fixture();
  const o = overview(db, '7d');
  assert.equal(o.kpis.find(k => k.key === 'players').value, 1);
  const b = balance(db, '7d');
  assert.equal(b.totals.attempts, 30);
  assert.equal(b.totals.rejected, 10);
  assert.ok(Math.abs(b.totals.reject_rate - 33.33) < .01);
  assert.equal(b.heatmap.size, 12);
  db.close();
});

test('market metrics include spend, revenue, ROAS and retention shape', () => {
  const db = fixture();
  const m = market(db, '30d');
  assert.ok(m.channels.length >= 1);
  assert.equal(m.totals.revenue, 4.99);
  assert.ok(m.totals.spend >= 2);
  assert.ok(m.totals.roas > 0);
  assert.ok(Array.isArray(m.retention.cohorts));
  assert.deepEqual(Object.keys(retention(db, '30d').overall), ['d1', 'd7', 'd30']);
  db.close();
});

test('fraud scoring never bans; only owner review can ban', () => {
  const db = fixture();
  const score = scorePlayer(db, 'player-test');
  assert.ok(score.risk >= 0 && score.risk <= 1);
  const made = createCaseIfNeeded(db, score, { threshold: 0 });
  assert.equal(made.created, true);
  assert.equal(db.prepare('SELECT status FROM players WHERE id=?').get('player-test').status, 'active');
  const reviewed = reviewCase(db, made.caseId, { status: 'confirmed', ban: true, actor: 'owner', note: 'manual evidence review' });
  assert.equal(reviewed.banned, true);
  assert.equal(db.prepare('SELECT status FROM players WHERE id=?').get('player-test').status, 'banned');
  db.close();
});

test('alerts deduplicate and evaluate from live metrics', () => {
  const db = fixture();
  const a = createAlert(db, { code: 'CRASH_RATE', title: 'test' });
  const b = createAlert(db, { code: 'CRASH_RATE', title: 'test' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  const evaluated = evaluateAlerts(db);
  assert.ok(Array.isArray(evaluated.created));
  db.close();
});

test('retention deletes only expired raw data', () => {
  const db = fixture();
  const old = new Date(Date.now() - 400 * 86400e3).toISOString();
  insert(db, 'input_logs', { event_id: 'old', ts: old, region: 'RU', accepted: 0 });
  insert(db, 'ai_requests', { id: uuid(), ts: old, zone: 'ops', provider: 'local', model: 'local', status: 'ok' });
  const cfg = loadConfig({ CRM_ENV: 'test' });
  const result = runRetention(db, cfg);
  assert.ok(result.input_logs >= 1);
  assert.ok(result.ai_requests >= 1);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM input_logs WHERE ts>?').get(old).n >= 30);
  db.close();
});
