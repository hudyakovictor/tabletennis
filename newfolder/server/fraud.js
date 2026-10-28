/* ─────────────────────────────────────────────────────────────────────────────
 * Детерминированный скоринг антифрода (этап 5 плана).
 * ВАЖНО: модуль ТОЛЬКО помечает подозрения и создаёт кейсы.
 * Блокировка игрока — исключительно ручное действие владельца из UI
 * (human-in-the-loop, 02-ai-zones.md / 04-security.md).
 * ─────────────────────────────────────────────────────────────────────────── */
import { insert, insertIgnore } from './db.js';
import { uuid, nowISO, round, clamp, safeJSON, rangeStart } from './util.js';

const WEIGHTS = {
  accuracy: 0.22, reaction_ms: 0.18, night_activity_ratio: 0.12,
  route_repeat: 0.20, payment_velocity: 0.16, device_shared: 0.12,
};

export function scorePlayer(db, playerId, range = '30d') {
  const from = rangeStart(range);
  const inputs = db.prepare(`SELECT along, across, timing_error_ms, shot_type, ts, pointer_type
    FROM input_logs WHERE player_id=? AND ts>=?`, playerId, from).all() || [];
  const sessions = db.prepare(`SELECT started_at, fps_avg FROM game_sessions WHERE player_id=? AND started_at>=?`, playerId, from).all() || [];
  const payments = db.prepare(`SELECT ts, amount_usd FROM payments WHERE player_id=? AND ts>=?`, playerId, from).all() || [];
  const player = db.prepare('SELECT device_fingerprint_hash, region FROM players WHERE id=?').get(playerId) || {};
  const signals = [];
  const reasons = [];

  // 1. Слишком одинаковые попадания: малое стандартное отклонение вдоль осей.
  let accuracy = 0;
  if (inputs.length >= 12) {
    const dev = (key) => {
      const vals = inputs.map(i => Number(i[key]) || 0);
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
    };
    const spread = (dev('along') + dev('across')) / 2;
    accuracy = clamp(1 - spread / 45, 0, 1);
    if (accuracy > 0.8) reasons.push(`Очень низкий разброс координат ударов (σ=${round(spread, 1)} px)`);
  }
  signals.push({ signal: 'accuracy', value: round(accuracy, 3), details: `${inputs.length} попыток ввода` });

  // 2. Реакция: тайминг Errors около нуля у ботов; человек ошибается.
  const timing = inputs.filter(i => Number.isFinite(Number(i.timing_error_ms)));
  const meanAbsTiming = timing.length ? timing.reduce((a, i) => a + Math.abs(Number(i.timing_error_ms)), 0) / timing.length : 999;
  const reaction = clamp(1 - meanAbsTiming / 90, 0, 1);
  signals.push({ signal: 'reaction_ms', value: round(meanAbsTiming, 1), details: 'среднее |timing_error_ms|' });
  if (reaction > 0.75 && inputs.length >= 12) reasons.push(`Подозрительно точный тайминг (|Δt|=${round(meanAbsTiming, 1)} мс)`);

  // 3. Ночная активность.
  const hours = sessions.map(s => new Date(s.started_at).getUTCHours());
  const nightRatio = hours.length ? hours.filter(h => h >= 0 && h < 6).length / hours.length : 0;
  signals.push({ signal: 'night_activity_ratio', value: round(nightRatio, 3), details: `${hours.length} сессий` });
  if (nightRatio > 0.6 && hours.length >= 5) reasons.push(`Активность преимущественно ночью (${round(nightRatio * 100)}% сессий)`);

  // 4. Повторяющиеся маршруты свайпов.
  let routeRepeat = 0;
  if (inputs.length >= 10) {
    const bins = new Map();
    for (const i of inputs) {
      const key = `${Math.round((Number(i.along) || 0) / 10)}:${Math.round((Number(i.across) || 0) / 10)}`;
      bins.set(key, (bins.get(key) || 0) + 1);
    }
    routeRepeat = clamp(Math.max(...bins.values()) / inputs.length, 0, 1);
    if (routeRepeat > 0.55) reasons.push(`Повторяющийся маршрут ввода (${round(routeRepeat * 100)}% в одном бине)`);
  }
  signals.push({ signal: 'route_repeat', value: round(routeRepeat, 3), details: 'макс. доля одного бина along/across' });

  // 5. Скорость платежей.
  let velocity = 0;
  if (payments.length >= 2) {
    const sorted = payments.map(p => Date.parse(p.ts)).sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      let c = 1;
      for (let j = i + 1; j < sorted.length && sorted[j] - sorted[i] <= 5 * 60e3; j++) c++;
      velocity = Math.max(velocity, c);
    }
    if (velocity >= 3) reasons.push(`${velocity} платежей в течение 5 минут`);
  }
  signals.push({ signal: 'payment_velocity', value: velocity, details: 'макс. платежей за 5 мин' });

  // 6. Общий fingerprint устройства (мультиаккаунты).
  let shared = 0;
  if (player.device_fingerprint_hash) {
    const cnt = db.prepare('SELECT COUNT(*) AS n FROM players WHERE device_fingerprint_hash=?')
      .get(player.device_fingerprint_hash).n;
    shared = clamp((cnt - 1) / 3, 0, 1);
    if (cnt > 1) reasons.push(`Один device_fingerprint_hash на ${cnt} аккаунта(ов)`);
  }
  signals.push({ signal: 'device_shared', value: round(shared, 3), details: 'совпадение отпечатка устройства' });

  const norm = {
    accuracy, reaction_ms: reaction, night_activity_ratio: clamp(nightRatio / 0.8, 0, 1),
    route_repeat: routeRepeat, payment_velocity: clamp(velocity / 4, 0, 1), device_shared: shared,
  };
  let risk = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) risk += (norm[k] || 0) * w;
  risk = round(clamp(risk, 0, 1), 3);
  return { playerId, region: player.region || 'OTHER', risk, signals, reasons, samples: { inputs: inputs.length, sessions: sessions.length, payments: payments.length } };
}

/** Создаёт кейс, только если риск выше порога и нет свежего открытого кейса. */
export function createCaseIfNeeded(db, score, { threshold = 0.55, actor = 'detector', maxAgeHours = 48 } = {}) {
  if (score.risk < threshold) return { created: false, reason: 'below threshold', score };
  const since = new Date(Date.now() - maxAgeHours * 3600e3).toISOString();
  const exists = db.prepare(`SELECT id FROM fraud_cases WHERE player_id=? AND ts>=? AND status IN ('open','confirmed')`)
    .get(score.playerId, since);
  if (exists) return { created: false, reason: 'recent case exists', caseId: exists.id, score };
  const caseId = uuid();
  const ts = nowISO();
  for (const s of score.signals) insert(db, 'fraud_signals', {
    id: uuid(), ts, player_id: score.playerId, region: score.region,
    signal: s.signal, value: Number(s.value) || 0, details: s.details || '',
  });
  insert(db, 'fraud_cases', {
    id: caseId, ts, player_id: score.playerId, region: score.region, risk_score: score.risk,
    status: 'open', reasons: JSON.stringify(score.reasons), signals: JSON.stringify(score.signals),
    review_note: null, reviewed_by: null, reviewed_at: null, created_by: actor,
  });
  db.prepare('UPDATE players SET risk_score=? WHERE id=?').run(score.risk, score.playerId);
  return { created: true, caseId, score };
}

/** Ночной скан активных игроков. Никогда ничего не банит. */
export function scanActivePlayers(db, { threshold = 0.55, limit = 500 } = {}) {
  const ids = db.prepare(`SELECT DISTINCT player_id FROM game_sessions
    WHERE started_at>=? AND player_id IS NOT NULL LIMIT ?`).all(rangeStart('7d'), limit).map(x => x.player_id);
  let created = 0, scanned = 0;
  for (const id of ids) {
    const s = scorePlayer(db, id, '30d');
    if (s.samples.inputs < 8) continue;
    scanned++;
    const res = createCaseIfNeeded(db, s, { threshold });
    if (res.created) created++;
  }
  return { scanned, created, threshold };
}

export function caseDetail(db, id) {
  const c = db.prepare('SELECT * FROM fraud_cases WHERE id=?').get(id);
  if (!c) return null;
  return {
    ...c,
    reasons: safeJSON(c.reasons, []),
    signals: safeJSON(c.signals, []),
    evidence: db.prepare(`SELECT signal, AVG(value) AS avg_value, COUNT(*) AS n, MAX(ts) AS last_ts
      FROM fraud_signals WHERE player_id=? GROUP BY signal ORDER BY avg_value DESC`).all(c.player_id),
    player: db.prepare('SELECT * FROM players WHERE id=?').get(c.player_id),
    recentInputs: db.prepare(`SELECT ts, along, across, reject_code, timing_error_ms, shot_type
      FROM input_logs WHERE player_id=? ORDER BY ts DESC LIMIT 30`).all(c.player_id),
  };
}

/** Ручное решение владельца. Только ОНО меняет статус игрока. */
export function reviewCase(db, id, { status, note = '', actor = 'owner', ban = false }) {
  const c = db.prepare('SELECT * FROM fraud_cases WHERE id=?').get(id);
  if (!c) return { ok: false, error: 'case not found' };
  if (!['open', 'confirmed', 'false_positive', 'banned'].includes(status)) return { ok: false, error: 'invalid status' };
  db.prepare('UPDATE fraud_cases SET status=?, review_note=?, reviewed_by=?, reviewed_at=? WHERE id=?')
    .run(status, note.slice(0, 2000), actor, nowISO(), id);
  if (ban && status === 'confirmed') {
    db.prepare(`UPDATE players SET status='banned', banned_at=?, ban_reason=? WHERE id=?`)
      .run(nowISO(), note.slice(0, 300) || 'Подтверждённый фрод', c.player_id);
    db.prepare('UPDATE fraud_cases SET status=? WHERE id=?').run('banned', id);
  }
  if (status === 'false_positive') db.prepare('UPDATE players SET risk_score=? WHERE id=?')
    .run(Math.min(0.2, c.risk_score / 2), c.player_id);
  return { ok: true, status, banned: ban && status === 'confirmed' };
}

export { WEIGHTS };
