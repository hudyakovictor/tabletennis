/* Запись валидных событий в нормализованные таблицы зон.
 * Один батч = одна транзакция. dedupe_key обеспечивает идемпотентность:
 * повторная отправка того же батча не создаёт дубликаты. */
import { insertIgnore, insert, updateRow } from './db.js';
import { nowISO, uuid, cleanStr, sha256 } from './util.js';

export function ingestBatch(db, events, meta = {}) {
  const received_at = nowISO();
  const source = cleanStr(meta.source || 'game-backend', 60);
  const keyId = cleanStr(meta.keyId || '', 60);
  let accepted = 0, duplicates = 0, dispatched = 0;
  const rejected = [];

  db.exec('BEGIN');
  try {
    const evStmt = db.prepare(`INSERT OR IGNORE INTO events
      (id,dedupe_key,type,player_id,session_id,region,ts,source,ingest_key_id,payload,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || !e.ok) { rejected.push({ index: i, reason: e?.error || 'invalid event' }); continue; }
      const v = e.event;
      const info = evStmt.run(v.id, v.dedupe_key, v.type, v.player_id, v.session_id,
        v.region, v.ts, v.source || source, keyId, cleanStr(JSON.stringify(v.data), 20000), received_at);
      if (!info.changes) { duplicates++; continue; }
      accepted++;
      try { dispatch(db, v); dispatched++; }
      catch (err) { rejected.push({ index: i, reason: `dispatch: ${String(err.message).slice(0, 100)}` }); }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { accepted, duplicates, dispatched, rejected, received_at };
}

function dispatch(db, e) {
  const d = e.data || {};
  switch (e.type) {
    case 'install': {
      const exists = db.prepare('SELECT 1 FROM players WHERE id=?').get(e.player_id);
      if (exists) break;
      insertIgnore(db, 'players', {
        id: e.player_id, region: e.region, created_at: e.ts, install_at: e.ts,
        channel: d.channel || 'organic', campaign: d.campaign || '', creative: d.creative || '',
        platform: d.platform || 'telegram', display_name: cleanStr(d.display_name, 80) || null,
        country_code: d.country_code || null, consent_telemetry: 0, consent_ai_analysis: 0,
        consent_marketing: 0, status: 'active',
      });
      break;
    }
    case 'session_start': {
      insertIgnore(db, 'game_sessions', {
        id: e.session_id || e.id, player_id: e.player_id, region: e.region,
        started_at: e.ts, device_type: d.device_type || 'unknown', build_version: d.build_version || null,
        rules_version: cleanStr(d.rules_version || '4', 20), platform: d.platform || null,
        hand: d.hand || null, grip: d.grip || null, ping_ms: d.ping_ms ?? null,
      });
      ensurePlayer(db, e);
      break;
    }
    case 'session_end': {
      const sid = e.session_id || e.id;
      const row = db.prepare('SELECT id FROM game_sessions WHERE id=?').get(sid);
      if (row) updateRow(db, 'game_sessions', sid, {
        ended_at: e.ts, duration_s: d.duration_s ?? null, fps_avg: d.fps_avg ?? null,
        crash: d.crash ? 1 : 0, matches: d.matches ?? 0, points: d.points ?? 0,
      });
      else insertIgnore(db, 'game_sessions', {
        id: sid, player_id: e.player_id, region: e.region, started_at: e.ts, ended_at: e.ts,
        device_type: d.device_type || 'unknown', fps_avg: d.fps_avg ?? null, crash: d.crash ? 1 : 0,
        duration_s: d.duration_s ?? null,
      });
      if (d.crash) insertIgnore(db, 'ops_crashes', {
        id: uuid(), ts: e.ts, player_id: e.player_id, session_id: sid, region: e.region,
        reason: d.reason || 'session crashed', build_version: d.build_version || null,
        device_type: d.device_type || null,
      });
      break;
    }
    case 'input': {
      // reject_code имеет приоритет: если он есть — удар отклонён.
      insertIgnore(db, 'input_logs', {
        event_id: e.id, session_id: e.session_id, player_id: e.player_id, region: e.region,
        ts: e.ts, pointer_type: d.pointer_type || 'unknown', along: d.along ?? null,
        across: d.across ?? null, reject_code: d.reject_code || null,
        ball_speed: d.ball_speed ?? null, spin: d.spin ?? null,
        accepted: d.reject_code ? 0 : (d.accepted ?? 1),
        build_version: d.build_version || null, rules_version: cleanStr(d.rules_version || '4', 20),
        device_type: d.device_type || null, shot_type: d.shot_type || null,
        timing_error_ms: d.timing_error_ms ?? null, distance_px: d.distance_px ?? null,
        direction_dot: d.direction_dot ?? null, hand: d.hand || null, grip: d.grip || null,
      });
      break;
    }
    case 'perf': {
      insertIgnore(db, 'ops_perf', {
        id: e.id, ts: e.ts, session_id: e.session_id, player_id: e.player_id, region: e.region,
        fps: d.fps ?? null, frame_ms: d.frame_ms ?? null, update_ms: d.update_ms ?? null,
        render_ms: d.render_ms ?? null, ui_ms: d.ui_ms ?? null, scale: d.scale ?? null,
        long_task_ms: d.long_task_ms ?? null, ping_ms: d.ping_ms ?? null,
        device_type: d.device_type || null, build_version: d.build_version || null,
      });
      break;
    }
    case 'error': {
      const stackHash = d.stack_hash || sha256(cleanStr(d.message, 300) + cleanStr(d.code, 60));
      const dup = db.prepare(`SELECT id, occurrences FROM ops_errors WHERE stack_hash=? AND ts>=? ORDER BY ts DESC LIMIT 1`)
        .get(stackHash, new Date(Date.parse(e.ts) - 3600e3).toISOString());
      if (dup) db.prepare('UPDATE ops_errors SET occurrences=occurrences+1 WHERE id=?').run(dup.id);
      else insertIgnore(db, 'ops_errors', {
        id: e.id, ts: e.ts, player_id: e.player_id, session_id: e.session_id, region: e.region,
        level: d.level || 'error', code: d.code || 'unknown', message: cleanStr(d.message, 2000),
        stack_hash: stackHash, build_version: d.build_version || null,
      });
      break;
    }
    case 'crash': {
      insertIgnore(db, 'ops_crashes', {
        id: e.id, ts: e.ts, player_id: e.player_id, session_id: e.session_id, region: e.region,
        reason: cleanStr(d.reason || d.message || 'unknown', 500), build_version: d.build_version || null,
        device_type: d.device_type || null,
      });
      break;
    }
    case 'http_request': {
      insertIgnore(db, 'ops_http', {
        id: e.id, ts: e.ts, region: e.region, route: cleanStr(d.route || '/', 200),
        method: cleanStr(d.method || 'GET', 10), status: Number(d.status) || 0,
        latency_ms: d.latency_ms ?? null,
      });
      break;
    }
    case 'ping': {
      insertIgnore(db, 'ops_pings', {
        id: e.id, ts: e.ts, region: e.region, endpoint: cleanStr(d.endpoint || '', 200),
        ping_ms: d.ping_ms ?? null, status: d.status || 'ok',
      });
      break;
    }
    case 'payment': {
      insertIgnore(db, 'payments', {
        id: e.id, player_id: e.player_id, region: e.region, ts: e.ts,
        amount_usd: d.amount_usd ?? 0, currency: d.currency || 'USD',
        product_id: d.product_id || 'unknown', product_kind: d.product_kind || 'unknown',
        status: d.status || 'paid', provider: d.provider || 'telegram-stars',
        country_code: d.country_code || e.region, refunded: d.refunded ? 1 : 0,
        chargeback: d.chargeback ? 1 : 0, idempotency_key: d.idempotency_key || e.id,
      });
      if (e.player_id && d.status !== 'failed') {
        db.prepare('UPDATE players SET ltv_usd = ltv_usd + ? WHERE id=?').run(d.amount_usd || 0, e.player_id);
      }
      break;
    }
    case 'economy': {
      insertIgnore(db, 'economy_events', {
        id: e.id, ts: e.ts, player_id: e.player_id, region: e.region, kind: d.kind || 'unknown',
        currency: d.currency || 'coins', amount: d.amount ?? 0, item_id: d.item_id || null,
        balance_after: d.balance_after ?? null,
      });
      break;
    }
    case 'marketing': {
      insertIgnore(db, 'market_events', {
        id: e.id, ts: e.ts, player_id: e.player_id, region: e.region,
        channel: d.channel || 'organic', campaign: d.campaign || '', creative: d.creative || '',
        type: d.type || 'spend', cost_usd: d.cost_usd ?? 0, installs: d.installs ?? 0,
        impressions: d.impressions ?? 0, clicks: d.clicks ?? 0,
      });
      break;
    }
    case 'test_result': {
      insertIgnore(db, 'lab_test_runs', {
        id: e.id, ts: e.ts, kind: d.kind || 'calibrate', source: d.source || 'npm run calibrate',
        payload: cleanStr(d.payload || JSON.stringify(d), 20000),
      });
      break;
    }
    case 'consent': {
      insertIgnore(db, 'consents', {
        id: e.id, player_id: e.player_id, region: e.region, ts: e.ts,
        telemetry: d.telemetry ? 1 : 0, ai_analysis: d.ai_analysis ? 1 : 0,
        marketing: d.marketing ? 1 : 0, source: d.source || 'client',
      });
      db.prepare(`UPDATE players SET consent_telemetry=?, consent_ai_analysis=?, consent_marketing=? WHERE id=?`)
        .run(d.telemetry ? 1 : 0, d.ai_analysis ? 1 : 0, d.marketing ? 1 : 0, e.player_id);
      ensurePlayer(db, e);
      break;
    }
    case 'deletion_request': {
      insertIgnore(db, 'deletion_requests', {
        id: e.id, player_id: e.player_id, region: e.region, ts: e.ts,
        status: 'pending', requested_by: d.source || 'player',
      });
      break;
    }
    case 'support_ticket': {
      const id = uuid();
      insertIgnore(db, 'tickets', {
        id, ts: e.ts, player_id: e.player_id, region: e.region,
        subject: cleanStr(d.subject || d.kind || 'Обращение', 200),
        body: cleanStr(d.message || d.payload || '', 6000), status: 'new',
        priority: d.level || 'normal', screenshot_url: d.screenshot_url || null,
        build_version: d.build_version || null, updated_at: e.ts,
        source: d.source || 'client',
      });
      break;
    }
    case 'match_end': {
      // Агрегат в сессию; детали матча остаются в events.payload.
      if (e.session_id) db.prepare('UPDATE game_sessions SET matches=matches+1, points=points+? WHERE id=?')
        .run(Number(d.rally) || 0, e.session_id);
      break;
    }
    case 'custom': break;
    default: break;
  }
}

function ensurePlayer(db, e) {
  if (!e.player_id) return;
  const exists = db.prepare('SELECT 1 FROM players WHERE id=?').get(e.player_id);
  if (!exists) insertIgnore(db, 'players', {
    id: e.player_id, region: e.region, created_at: e.ts, install_at: e.ts,
    channel: 'organic', campaign: '', creative: '', platform: 'unknown', status: 'active',
  });
}
