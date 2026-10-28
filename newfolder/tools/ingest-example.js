#!/usr/bin/env node
/* Пример подписанного батча от игрового бэкенда.
 * CRM_URL=http://localhost:4173 INGEST_KEY_ID=game-local INGEST_SECRET=... node tools/ingest-example.js
 * Секрет НЕ встраивается в игровой клиент: этот скрипт запускается на бэкенде. */
import crypto from 'node:crypto';

const base = process.env.CRM_URL || 'http://localhost:4173';
const keyId = process.env.INGEST_KEY_ID || 'game-local';
const secret = process.env.INGEST_SECRET || 'dev-secret-change-me-please-32chars';
const timestamp = Math.floor(Date.now() / 1000).toString();
const playerId = `example-${process.pid}`;
const sessionId = `session-${Date.now()}`;
const body = JSON.stringify({ events: [
  { type: 'install', ts: new Date().toISOString(), region: 'RU', player_id: playerId, data: { channel: 'organic', campaign: 'integration-test', platform: 'telegram' } },
  { type: 'session_start', ts: new Date().toISOString(), region: 'RU', player_id: playerId, session_id: sessionId, data: { device_type: 'touch', build_version: 'integration-1', rules_version: '4', hand: 'right', grip: 'shakehand' } },
  { type: 'input', ts: new Date().toISOString(), region: 'RU', player_id: playerId, session_id: sessionId, data: { pointer_type: 'touch', accepted: 0, reject_code: 'OUTSIDE_ZONE', along: 42.5, across: -18.2, ball_speed: 8.1, spin: 20, timing_error_ms: 32, distance_px: 77, build_version: 'integration-1', rules_version: '4', device_type: 'touch' } },
  { type: 'perf', ts: new Date().toISOString(), region: 'RU', player_id: playerId, session_id: sessionId, data: { fps: 58.2, frame_ms: 17.1, update_ms: 3.2, render_ms: 8.4, ui_ms: 1.1, ping_ms: 46 } },
  { type: 'session_end', ts: new Date().toISOString(), region: 'RU', player_id: playerId, session_id: sessionId, data: { duration_s: 120, fps_avg: 58.2, crash: 0, matches: 1, points: 11 } },
] });
const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
const res = await fetch(`${base}/api/ingest/events`, {
  method: 'POST', headers: {
    'Content-Type': 'application/json', 'x-tt-key': keyId,
    'x-tt-timestamp': timestamp, 'x-tt-signature': signature,
    'x-tt-nonce': crypto.randomUUID(),
  }, body,
});
console.log(res.status, await res.text());
if (!res.ok) process.exitCode = 1;
