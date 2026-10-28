'use strict';

/**
 * Deterministic Domain-Accurate Seed Data for TOPSPIN ARENA Admin CRM (v2 — 15-Factor 95+)
 *
 * Seeds:
 * - Bootstrap Owner Admin (`owner@topspin.arena` / `TopSpinAdmin!2026`)
 * - Full 34-field `MATCH_RULES` v4 (`12_match_rules.js` parity) + historical v3
 * - 6 AI zone runtime configs (`ops`, `fraud`, `balance`, `market`, `lab`, `director`)
 * - 7 Provider DPA / Zero-Retention registry rows (`provider_dpa_registry`)
 * - 8 Legal documents (4 doc types × RU/EN: `tos`, `privacy_policy`, `eula`, `cookie_policy`)
 * - 120 Players across `RU`, `EU`, `KZ`, `BY`, `US`, `TR` + explicit consents + minor parental consent sample
 * - 260 Sessions (including a 24/7 marathon bot account + multi-account device cluster + TMA RTT tiers)
 * - 1,800+ Input Events across all 6 `table_zone` cells (`short/deep × bh/mid/fh`), `has_fresh_swipe`,
 *   `swipe_straightness`, all 10 `PRESS_REJECTION_REASONS`, repeating-route bot pattern, and touch `OUTSIDE_ZONE` surge
 * - Payments (including burst velocity & geo-mismatch cases), Ad events, Economy sink/source ledger, Marketing campaigns
 * - Lab runs (`calibrate`, `noise`, `browser_e2e`), Statistical A/B experiments (`p < 0.05` winner + exploratory)
 * - Telemetry golden signals, Incidents, Blameless Post-Mortem, Support tickets with screenshot & status history,
 *   Player feedback loop (`collected -> sorted -> prioritized -> responded`), Patch pipeline (`Day-1/Week-1/Bi-weekly/Beta`),
 *   6–12m LiveOps calendar, News, Priority Pushes, Active + >72h Archived Director Chat (in `director-archive.sqlite`),
 *   and fresh validated AI summaries across all 5 isolated zones!
 */

const crypto = require('node:crypto');
const { CONFIG, AI_ZONES, MATCH_RULES_V4, PRESS_REJECTION_REASONS, TABLE_ZONES } = require('../config');
const { moveExpiredDirectorChatToArchiveDb } = require('./database');
const { ensureBootstrapAdmin, hashIdentifier } = require('../security/auth');
const { runOpsZoneAnalysis } = require('../ai/zones/opsZone');
const { runFraudZoneAnalysis } = require('../ai/zones/fraudZone');
const { runBalanceZoneAnalysis } = require('../ai/zones/balanceZone');
const { runMarketZoneAnalysis } = require('../ai/zones/marketZone');
const { runLabZoneAnalysis } = require('../ai/zones/labZone');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function seedDatabaseIfEmpty(db, force = false) {
  ensureBootstrapAdmin(db);

  const existingPlayers = Number(db.prepare('SELECT COUNT(*) AS cnt FROM players').get()?.cnt || 0);
  if (existingPlayers > 0 && !force) {
    return { seeded: false, players: existingPlayers };
  }

  if (force) {
    const clearTables = [
      'support_ticket_events',
      'support_messages',
      'support_tickets',
      'player_feedback',
      'patch_pipeline',
      'liveops_events',
      'news_posts',
      'push_notifications',
      'privacy_requests',
      'player_consents',
      'legal_documents',
      'provider_dpa_registry',
      'postmortems',
      'incidents',
      'action_proposals',
      'ab_experiments',
      'lab_runs',
      'economy_ledger',
      'ad_events',
      'marketing_campaigns',
      'fraud_cases',
      'payments',
      'telemetry_metrics',
      'input_events',
      'sessions',
      'players',
      'director_chat',
      'director_state',
      'zone_summaries',
      'ai_quarantine',
      'ai_requests',
      'match_rules_versions',
    ];
    for (const tbl of clearTables) {
      db.prepare(`DELETE FROM ${tbl}`).run();
    }
  }

  const rng = mulberry32(20261028);
  const now = Date.now();
  const isoAgo = (hours) => new Date(now - hours * 3600 * 1000).toISOString();
  const isoAhead = (hours) => new Date(now + hours * 3600 * 1000).toISOString();

  // 1. Seed AI Zone Configs (6 isolated roles)
  const upsertZoneCfg = db.prepare(
    `INSERT INTO ai_zone_configs
     (zone, provider, fallback_provider, model, daily_token_limit, zero_retention, batch_mode, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(zone) DO UPDATE SET
       daily_token_limit = excluded.daily_token_limit,
       zero_retention = excluded.zero_retention,
       batch_mode = excluded.batch_mode`
  );
  for (const z of Object.values(AI_ZONES)) {
    upsertZoneCfg.run(
      z.zone,
      z.provider,
      z.fallbackProvider || 'local_statistical',
      z.model,
      z.dailyTokenLimit,
      z.zeroRetention ? 1 : 0,
      z.batchMode ? 1 : 0,
      isoAgo(120)
    );
  }

  // 2. Seed Provider DPA & Zero-Data-Retention Registry (05-legal & 16-legal)
  const dpaRows = [
    ['local_statistical', 'RU', 'signed', 1, 0, 'Локальное детерминированное ядро в контуре РФ (ПДн не покидают сервер)'],
    ['ollama', 'RU', 'signed', 1, 0, 'Локальные open-weights модели (Qwen/Llama) внутри РФ-контура'],
    ['yandexgpt', 'RU', 'signed', 1, 0, 'Yandex Cloud Foundation Models (152-ФЗ, ЦОД РФ, без дообучения на логах)'],
    ['gigachat', 'RU', 'signed', 1, 0, 'SberDevices GigaChat Корпоративный контур РФ (152-ФЗ)'],
    ['openrouter', 'US/EU', 'signed', 1, 0, 'Только обезличенные агрегаты зон с заголовком X-Data-Retention: none'],
    ['nvidia', 'US/EU', 'signed', 1, 0, 'NVIDIA NIM inference — только неперсонализированные метрики баланса/лаборатории'],
    ['selectel_ru_hosting', 'RU', 'signed', 1, 1, 'Первичный хостинг БД игроков РФ (Москва / Санкт-Петербург, УЗ-3 152-ФЗ)'],
  ];
  const insDpa = db.prepare(
    `INSERT INTO provider_dpa_registry (provider, country, dpa_status, zero_data_retention, pii_allowed, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of dpaRows) {
    insDpa.run(r[0], r[1], r[2], r[3], r[4], r[5], isoAgo(200));
  }

  // 3. Seed MATCH_RULES v3 (historical) & v4 (active 34-field canonical contract from 12_match_rules.js)
  const rulesV3 = { ...MATCH_RULES_V4, version: 3, ovalForwardMaxPx: 112, contactSideTouchPx: 58 };
  db.prepare(
    `INSERT INTO match_rules_versions (version, rules_json, is_active, comment, created_by, created_at)
     VALUES (3, ?, 0, 'Предыдущая ревизия MATCH_RULES v3 до калибровки мобильного овала', 'owner@topspin.arena', ?)`
  ).run(JSON.stringify(rulesV3), isoAgo(420));

  db.prepare(
    `INSERT INTO match_rules_versions (version, rules_json, is_active, comment, created_by, created_at)
     VALUES (4, ?, 1, 'Канонический замороженный профиль MATCH_RULES v4 (34 поля из 12_match_rules.js)', 'owner@topspin.arena', ?)`
  ).run(JSON.stringify(MATCH_RULES_V4), isoAgo(240));

  // 4. Maintenance Mode initial setting (OFF)
  db.prepare(
    `INSERT OR REPLACE INTO system_settings (key, value_json, updated_by, updated_at)
     VALUES ('maintenance_mode', ?, 'owner@topspin.arena', ?)`
  ).run(
    JSON.stringify({
      enabled: false,
      bannerRu: '',
      bannerEn: '',
      etaIso: null,
      allowActiveMatchesFinishGraceSec: 180,
      blockNewMatchesHttp503: false,
    }),
    isoAgo(48)
  );

  // 5. Legal Documents: ALL 4 types (`tos`, `privacy_policy`, `eula`, `cookie_policy`) in BOTH `ru` and `en` (8 rows)
  const legalEntries = [
    ['tos', '1.3', 'ru', 'Пользовательское соглашение (ToS) TOPSPIN ARENA', '1. Правила честной игры: запрещены макросы свайпов, авто-кликеры, модификация WebView и подмена телеметрии.\n2. Нарушения проверяются исключительно человеком-администратором (автобаны ИИ отключены).\n3. Внутриигровые покупки предоставляют доступ к косметическим предметам без преимуществ Pay-to-Win.'],
    ['tos', '1.3', 'en', 'TOPSPIN ARENA Terms of Service', '1. Fair Play: swipe macros, auto-clickers, WebView memory tampering, and packet spoofing are strictly prohibited.\n2. All anti-fraud sanctions require human administrator verification (zero AI auto-bans).\n3. Virtual items are purely cosmetic with zero Pay-to-Win gameplay modifiers.'],
    ['privacy_policy', '1.3', 'ru', 'Политика конфиденциальности (152-ФЗ / GDPR)', '1. Локализация: данные игроков из РФ хранятся и первично обрабатываются на серверах в РФ (152-ФЗ).\n2. Сроки хранения: сырые логи ввода — 90 дней, сессии — 180 дней, история чата — 365 дней.\n3. ИИ-аналитика работает только по обезличенным представлениям БД без ПДн.\n4. Право на удаление (Right to Erasure) исполняется в срок до 30 дней с анонимизацией налоговых записей.'],
    ['privacy_policy', '1.3', 'en', 'Privacy Policy (GDPR / 152-FZ)', '1. Data Residency: regional personal data stays in its designated cluster (RU 152-FZ / EU GDPR).\n2. Retention: raw input events 90d, telemetry 180d, chat archive 365d.\n3. AI workers read anonymized database views only — zero PII leaves the database.\n4. Right to Erasure requests complete within 30 days.'],
    ['eula', '1.1', 'ru', 'Лицензионное соглашение конечного пользователя (EULA)', 'Неисключительная отзываемая лицензия на использование клиента TOPSPIN ARENA в Telegram Mini Apps и браузерах. Запрещается декомпиляция сетевого протокола, обход региональных ограничений (включая CN без ICP) и эксплуатация уязвимостей физики мяча.'],
    ['eula', '1.1', 'en', 'End User License Agreement (EULA)', 'Limited, non-exclusive, revocable license to play TOPSPIN ARENA via Telegram Mini Apps and web browsers. Reverse engineering of binary state frames, bypassing regional compliance gates, or exploiting physics desyncs is prohibited.'],
    ['cookie_policy', '1.1', 'ru', 'Политика Cookie и локального хранилища WebView', 'Используются строго необходимые ключи сессионной привязки (affinityToken), настройки хвата ракетки (shakehand/penhold), ведущей руки и звука. Аналитические идентификаторы активируются только при явном согласии (opt-in).'],
    ['cookie_policy', '1.1', 'en', 'Cookie & WebView Local Storage Policy', 'Strictly necessary storage is used for session affinity tokens, racket grip (shakehand/penhold), dominant hand, and audio preferences. Analytics identifiers require explicit opt-in consent.'],
  ];
  const insLegal = db.prepare(
    `INSERT INTO legal_documents (id, doc_type, version, lang, title, content_md, requires_reconsent, published_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  );
  for (const l of legalEntries) {
    insLegal.run(crypto.randomUUID(), l[0], l[1], l[2], l[3], l[4], isoAgo(300));
  }

  // 6. Seed 120 Players + Consents
  const regions = ['RU', 'RU', 'RU', 'EU', 'KZ', 'BY', 'US', 'TR'];
  const sources = ['telegram_ads', 'organic_tma', 'ton_community', 'youtube_shorts', 'referral_friend', 'vk_clips'];
  const campaignsBySource = {
    telegram_ads: ['tma_spin_masters_q4', 'ru_sports_channels'],
    organic_tma: ['catalog_featured'],
    ton_community: ['tournament_cup_oct'],
    youtube_shorts: ['trickshot_creator_pack'],
    referral_friend: ['invite_2v2_bonus'],
    vk_clips: ['cis_cyber_pingpong_bad_roas'],
  };

  const insPlayer = db.prepare(
    `INSERT INTO players
     (id, external_id_hash, display_name, region, install_source, install_campaign, install_creative, status, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  );
  const insConsent = db.prepare(
    `INSERT INTO player_consents
     (id, player_id, region, doc_type, doc_version, declared_age, is_minor, parental_consent, analytics_opt_in, marketing_opt_in, ip_hash, consented_at)
     VALUES (?, ?, ?, 'tos', '1.3', ?, ?, ?, ?, ?, ?, ?)`
  );

  const players = [];
  for (let i = 1; i <= 120; i++) {
    const id = `plr_${String(i).padStart(4, '0')}`;
    const region = regions[i % regions.length];
    const src = sources[i % sources.length];
    const campList = campaignsBySource[src];
    const camp = campList[i % campList.length];
    const creative = `cr_${src.slice(0, 4)}_${(i % 3) + 1}`;
    const createdHoursAgo = Math.floor(24 + rng() * 680);
    const lastSeenHoursAgo = Math.floor(rng() * Math.min(createdHoursAgo, 72));
    const createdIso = isoAgo(createdHoursAgo);
    const seenIso = isoAgo(lastSeenHoursAgo);

    insPlayer.run(
      id,
      hashIdentifier(`tg_${100000 + i}`),
      `Player_${1000 + i}`,
      region,
      src,
      camp,
      creative,
      createdIso,
      seenIso
    );

    const isMinorSample = i === 7; // 15yo EU minor with verified parental consent (GDPR-K 16+)
    const age = isMinorSample ? 15 : 18 + (i % 24);
    insConsent.run(
      crypto.randomUUID(),
      id,
      isMinorSample ? 'EU' : region,
      age,
      isMinorSample ? 1 : 0,
      isMinorSample ? 1 : 0,
      i % 5 !== 0 ? 1 : 0,
      i % 3 === 0 ? 1 : 0,
      hashIdentifier(`ip_${i}`),
      createdIso
    );

    players.push({ id, region, src, camp, creative });
  }

  // Dedicated bot/fraud archetypes among players:
  // plr_0002 -> Aim/Reaction/Linear-swipe macro bot
  // plr_0003 -> 24/7 Marathon bot (active across 22 distinct UTC hours in last 36h)
  // plr_0004 -> Repeating-route script bot
  // plr_0005, plr_0006, plr_0008, plr_0009 -> Multi-account cluster sharing `dev_shared_cluster_99`
  // plr_0010 -> Payment velocity burst (5 tx in 8 minutes) + geo mismatch

  const platforms = ['tma_ios', 'tma_android', 'tma_android', 'web_desktop'];
  const insSession = db.prepare(
    `INSERT INTO sessions
     (id, player_id, region, platform, device_hash, ip_hash, rtt_p50_ms, rtt_p95_ms, avg_fps, p5_fps, crashed, webgl_lost, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const sessions = [];

  // 24/7 Marathon bot sessions across 22 distinct hours for plr_0003
  for (let h = 1; h <= 22; h++) {
    const sid = `ses_247_${String(h).padStart(2, '0')}`;
    const sStart = isoAgo(h);
    const sEnd = isoAgo(Math.max(0.1, h - 0.7));
    insSession.run(
      sid,
      'plr_0003',
      'RU',
      'web_desktop',
      hashIdentifier('dev_bot_247'),
      hashIdentifier('ip_bot_247'),
      28,
      44,
      60,
      59,
      0,
      0,
      sStart,
      sEnd
    );
    sessions.push({ id: sid, playerId: 'plr_0003', region: 'RU', platform: 'web_desktop', startHoursAgo: h });
  }

  // Multi-account shared device sessions
  const sharedDevHash = hashIdentifier('dev_shared_cluster_99');
  for (const pid of ['plr_0005', 'plr_0006', 'plr_0008', 'plr_0009']) {
    const sid = `ses_multi_${pid}`;
    insSession.run(
      sid,
      pid,
      'RU',
      'tma_android',
      sharedDevHash,
      hashIdentifier('ip_shared_99'),
      46,
      82,
      58,
      50,
      0,
      0,
      isoAgo(18),
      isoAgo(17.5)
    );
    sessions.push({ id: sid, playerId: pid, region: 'RU', platform: 'tma_android', startHoursAgo: 18 });
  }

  // Regular + TMA latency tier sessions (240 sessions, leaving 8 active open sessions for live CCU)
  for (let s = 1; s <= 240; s++) {
    const p = players[s % players.length];
    const plat = platforms[s % platforms.length];
    const hoursAgo = +(rng() * 140).toFixed(2);
    const isOpenCcu = s <= 8;

    // Distribute RTT across <35ms, 35-65ms, 65-100ms, 100-150ms, and a few >150ms on mobile 4G
    let rtt50 = 26 + rng() * 36;
    if (s % 9 === 0) rtt50 = 70 + rng() * 26;
    if (s % 19 === 0) rtt50 = 108 + rng() * 34;
    if (s % 47 === 0) rtt50 = 158 + rng() * 25;
    const rtt95 = rtt50 * (1.45 + rng() * 0.35);

    const crashed = plat === 'tma_android' && s % 65 === 0 ? 1 : 0;
    const webglLost = plat === 'tma_android' && s % 80 === 0 ? 1 : 0;
    const avgFps = plat === 'web_desktop' ? 59.8 : 55 + rng() * 5;
    const p5Fps = crashed ? 19 : avgFps - (4 + rng() * 8);

    const sid = `ses_${String(s).padStart(4, '0')}`;
    insSession.run(
      sid,
      p.id,
      p.region,
      plat,
      hashIdentifier(`dev_${p.id}`),
      hashIdentifier(`ip_${p.id}`),
      +rtt50.toFixed(1),
      +rtt95.toFixed(1),
      +avgFps.toFixed(1),
      +p5Fps.toFixed(1),
      crashed,
      webglLost,
      isoAgo(hoursAgo),
      isOpenCcu ? null : isoAgo(Math.max(0, hoursAgo - 0.25))
    );
    sessions.push({ id: sid, playerId: p.id, region: p.region, platform: plat, startHoursAgo: hoursAgo });
  }

  // 6b. Seed the DSAR queue: every state a legal operator must be able to see.
  // One healthy, one near the deadline, one already overdue and one closed — an
  // empty queue on a demo would hide exactly the SLA mechanic the screen exists for.
  const insPrivacy = db.prepare(
    `INSERT INTO privacy_requests
       (id, player_id, region, request_type, status, reason, requested_at, due_at, completed_at,
        processed_by, source, notes, rejection_reason, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const dsarSla = 30;
  const dsarDaysAgo = (days) => isoAgo(days * 24);
  const dsarDue = (days) => isoAhead((dsarSla - days) * 24);
  insPrivacy.run(
    'dsar_seed_export_ok', 'plr_0007', 'RU', 'export', 'pending',
    'Прошу копию моих данных для проверки', dsarDaysAgo(3), dsarDue(3), null, null,
    'player_client', 'intake: player_client', null, dsarDaysAgo(3)
  );
  insPrivacy.run(
    'dsar_seed_erasure_due_soon', 'plr_0011', 'EU', 'erasure', 'in_progress',
    'GDPR Art. 17: удаление аккаунта и связанных данных', dsarDaysAgo(27), dsarDue(27), null,
    'owner@topspin.arena', 'operator', 'intake: owner@topspin.arena', null, dsarDaysAgo(2)
  );
  insPrivacy.run(
    'dsar_seed_export_overdue', 'plr_0019', 'RU', 'export', 'pending',
    'Повторный запрос после обращения в поддержку', dsarDaysAgo(41), dsarDue(41), null, null,
    'player_client', 'intake: player_client', null, dsarDaysAgo(41)
  );
  insPrivacy.run(
    'dsar_seed_erasure_done', 'plr_0023', 'RU', 'erasure', 'completed',
    'Удаление по обращению в поддержку', dsarDaysAgo(20), dsarDue(20),
    dsarDaysAgo(18), 'owner@topspin.arena', 'operator', null, null, dsarDaysAgo(18)
  );

  // 7. Seed 1,850+ Input Events across all 6 table zones, grips, hands, and 10 reject codes
  const insInput = db.prepare(
    `INSERT INTO input_events
     (session_id, player_id, ts, pointer_type, grip, hand, is_serve, table_zone, has_fresh_swipe, swipe_straightness,
      along, across, accepted, contact, is_grace, reject_code, stroke_type, ball_speed, spin, reaction_ms, sweet_spot_dist, rules_version, ab_variant)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, ?)`
  );

  const insertInputsTx = db.transaction(() => {
    // 7a. Macro Aim Bot (plr_0002): 32 accepted shots, 97% sweet-spot <=0.05, 88ms reaction, 0.997 straightness
    for (let k = 0; k < 32; k++) {
      insInput.run(
        sessions[2].id,
        'plr_0002',
        isoAgo(10 - k * 0.01),
        'mouse',
        'shakehand',
        'right',
        k % 6 === 0 ? 1 : 0,
        TABLE_ZONES[k % TABLE_ZONES.length],
        1,
        0.997,
        +(rng() * 14 - 7).toFixed(2),
        +(rng() * 10 - 5).toFixed(2),
        1,
        1,
        0,
        null,
        'topspin_drive',
        19.4,
        420,
        +(84 + rng() * 12).toFixed(1),
        +(0.01 + rng() * 0.04).toFixed(4),
        null
      );
    }

    // 7b. Repeating Route Script Bot (plr_0004): exact identical quantized route (24, -14, 'forehand_loop') 14 times
    for (let k = 0; k < 14; k++) {
      insInput.run(
        sessions[4].id,
        'plr_0004',
        isoAgo(8 - k * 0.01),
        'touch',
        'shakehand',
        'right',
        0,
        'deep_fh',
        1,
        0.985,
        24.0,
        -14.0,
        1,
        1,
        0,
        null,
        'forehand_loop',
        17.8,
        360,
        142,
        0.11,
        null
      );
    }

    // 7c. Organic player telemetry across 1,800 strokes (including touch OUTSIDE_ZONE surge & deep_bh difficulty)
    const strokes = ['drive', 'topspin_loop', 'backhand_flick', 'push_chop', 'smash', 'block'];
    for (let i = 0; i < 1800; i++) {
      const ses = sessions[(i + 6) % sessions.length];
      if (ses.playerId === 'plr_0002' || ses.playerId === 'plr_0004') continue;

      const pointer = ses.platform === 'web_desktop' ? 'mouse' : i % 17 === 0 ? 'pen' : 'touch';
      const grip = i % 4 === 0 ? 'penhold' : 'shakehand';
      const hand = i % 6 === 0 ? 'left' : 'right';
      const tableZone = TABLE_ZONES[i % TABLE_ZONES.length];

      // Make deep_bh and touch/penhold/left realistically harder so Balance AI discovers real insights!
      let rejectProb = pointer === 'touch' ? 0.27 : 0.14;
      if (tableZone === 'deep_bh') rejectProb += 0.14;
      if (grip === 'penhold' && hand === 'left') rejectProb += 0.11;

      const accepted = rng() > rejectProb ? 1 : 0;
      const hasFreshSwipe = accepted ? 1 : rng() > 0.22 ? 1 : 0;
      let rejectCode = null;
      if (!accepted) {
        if (!hasFreshSwipe) {
          rejectCode = rng() > 0.4 ? 'NO_FRESH_SWIPE' : 'STATIC_CLICK';
        } else if (pointer === 'touch' && rng() < 0.72) {
          rejectCode = 'OUTSIDE_ZONE';
        } else {
          rejectCode = PRESS_REJECTION_REASONS[i % PRESS_REJECTION_REASONS.length];
        }
      }

      const along = accepted
        ? +((rng() - 0.5) * 150).toFixed(2)
        : +((rng() > 0.5 ? 1 : -1) * (115 + rng() * 55)).toFixed(2);
      const across = accepted
        ? +((rng() - 0.5) * 100).toFixed(2)
        : +((rng() > 0.5 ? 1 : -1) * (80 + rng() * 45)).toFixed(2);

      const contact = accepted ? (tableZone === 'deep_bh' && rng() < 0.18 ? 0 : rng() > 0.08 ? 1 : 0) : 0;
      const abVariant = i % 2 === 0 ? 'oval_touch_plus8_control' : 'oval_touch_plus8_treatment';

      insInput.run(
        ses.id,
        ses.playerId,
        isoAgo(Math.max(0.05, ses.startHoursAgo - (i % 20) * 0.002)),
        pointer,
        grip,
        hand,
        i % 7 === 0 ? 1 : 0,
        tableZone,
        hasFreshSwipe,
        +(0.72 + rng() * 0.23).toFixed(4),
        along,
        across,
        accepted,
        contact,
        accepted && Math.abs(along) > 105 ? 1 : 0,
        rejectCode,
        strokes[i % strokes.length],
        accepted ? +(9.5 + rng() * 14.5).toFixed(2) : 0,
        accepted ? +((rng() - 0.3) * 520).toFixed(1) : 0,
        +(165 + rng() * 195).toFixed(1),
        accepted ? +(0.09 + rng() * 0.48).toFixed(4) : null,
        abVariant
      );
    }
  });
  insertInputsTx();

  // 8. Marketing Campaigns (including a negative-ROAS campaign for Market AI + HITL)
  const campaigns = [
    ['mc_1', 'telegram_ads', 'tma_spin_masters_q4', 'cr_tma_spin_video', 1420, 290000, 14800, 1120, 68, 492, 268, 128, 2380],
    ['mc_2', 'organic_tma', 'catalog_featured', 'cr_org_banner', 0, 95000, 8200, 840, 44, 410, 235, 118, 1490],
    ['mc_3', 'ton_community', 'tournament_cup_oct', 'cr_ton_cup_post', 680, 110000, 6100, 490, 39, 230, 134, 67, 1190],
    ['mc_4', 'youtube_shorts', 'trickshot_creator_pack', 'cr_yt_short_01', 950, 410000, 11900, 760, 35, 312, 152, 64, 1140],
    ['mc_5', 'vk_clips', 'cis_cyber_pingpong_bad_roas', 'cr_vk_broad_03', 890, 260000, 5200, 310, 9, 88, 29, 11, 410],
  ];
  const insCamp = db.prepare(
    `INSERT INTO marketing_campaigns
     (id, source, campaign, creative, spend_usd, impressions, clicks, installs, paying_users, d1_retained, d7_retained, d30_retained, revenue_d30_usd, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of campaigns) {
    insCamp.run(...c, isoAgo(2));
  }

  // 9. Payments (including burst velocity & geo mismatch on plr_0010) + Ad Events + Economy Ledger
  const insPay = db.prepare(
    `INSERT INTO payments
     (id, player_id, region, amount_usd, currency, provider, item_sku, status, billing_country, session_country, risk_flag, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?)`
  );
  const skus = [
    ['blade_carbon_neon', 4.99],
    ['trail_plasma_gold', 2.99],
    ['pass_season1_pro', 7.99],
    ['gems_pack_500', 9.99],
  ];
  for (let i = 0; i < 68; i++) {
    const p = players[(i * 3) % players.length];
    const [sku, price] = skus[i % skus.length];
    insPay.run(
      `pay_${String(i + 1).padStart(4, '0')}`,
      p.id,
      p.region,
      price,
      'XTR',
      'telegram_stars',
      sku,
      p.region === 'EU' ? 'DE' : p.region,
      p.region === 'EU' ? 'DE' : p.region,
      0,
      isoAgo(4 + i * 3.2)
    );
  }
  // Fraud payment velocity burst (5 payments within 6 minutes + geo mismatch NG vs RU) for plr_0010
  for (let b = 0; b < 5; b++) {
    insPay.run(
      `pay_burst_${b + 1}`,
      'plr_0010',
      'RU',
      19.99,
      'USD',
      'stripe_card',
      'gems_pack_2000',
      'NG',
      'RU',
      1,
      new Date(now - (120 + b) * 60_000).toISOString()
    );
  }

  const insAd = db.prepare(
    `INSERT INTO ad_events (id, player_id, placement, network, revenue_usd, rewarded, created_at)
     VALUES (?, ?, ?, 'telegram_ads_sdk', ?, ?, ?)`
  );
  for (let a = 0; a < 220; a++) {
    const p = players[a % players.length];
    insAd.run(
      `ad_${a + 1}`,
      p.id,
      a % 2 === 0 ? 'rewarded_retry_spin' : 'interstitial_post_tourney',
      +(0.008 + rng() * 0.018).toFixed(4),
      a % 2 === 0 ? 1 : 0,
      isoAgo((a % 96) + 0.5)
    );
  }

  // Economy Ledger: intentionally slightly inflationary coins (sink/source ~ 0.54) so Market AI flags it
  const insEco = db.prepare(
    `INSERT INTO economy_ledger (id, player_id, currency, delta, flow_type, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (let e = 0; e < 140; e++) {
    const p = players[e % players.length];
    insEco.run(`eco_src_${e}`, p.id, 'coins', 250, 'source', 'match_win_reward', isoAgo(e % 120));
    if (e % 2 === 0) {
      insEco.run(`eco_snk_${e}`, p.id, 'coins', -270, 'sink', 'cosmetic_rubber_tint', isoAgo(e % 120));
    }
    if (e % 5 === 0) {
      insEco.run(`eco_gsrc_${e}`, p.id, 'gems', 50, 'source', 'season_pass_tier', isoAgo(e % 120));
      insEco.run(`eco_gsnk_${e}`, p.id, 'gems', -45, 'sink', 'arena_neon_theme', isoAgo(e % 120));
    }
  }

  // 10. Seed Telemetry Golden Signals (24 hourly buckets)
  const insMetric = db.prepare(
    `INSERT INTO telemetry_metrics (bucket_ts, metric_name, metric_value, labels_json)
     VALUES (?, ?, ?, '{}')`
  );
  for (let h = 24; h >= 1; h--) {
    const bTs = isoAgo(h);
    insMetric.run(bTs, 'http_latency_p50_ms', +(5.8 + rng() * 2.4).toFixed(2));
    insMetric.run(bTs, 'http_latency_p95_ms', +(16.5 + rng() * 6.0).toFixed(2));
    insMetric.run(bTs, 'http_latency_p99_ms', h === 1 ? 68.4 : +(29.0 + rng() * 7.5).toFixed(2)); // 2-sigma spike in latest bucket!
    insMetric.run(bTs, 'http_4xx_count', Math.floor(2 + rng() * 4));
    insMetric.run(bTs, 'http_5xx_count', h === 1 ? 2 : Math.floor(rng() * 2));
    insMetric.run(bTs, 'ws_timeout_count', Math.floor(rng() * 3));
  }

  // 11. Seed Lab Runs & Statistical A/B Experiments
  const insLab = db.prepare(
    `INSERT INTO lab_runs (id, suite, git_branch, status, duration_ms, summary_json, created_at)
     VALUES (?, ?, 'arena/6529cdce-tabletennis', 'passed', ?, ?, ?)`
  );
  insLab.run(
    crypto.randomUUID(),
    'calibrate',
    840,
    JSON.stringify({ runner: 'calibrate.cjs', checkedProfiles: 6, physicsDrift: 0.0, maxSpeedMs: 31.4 }),
    isoAgo(6)
  );
  insLab.run(
    crypto.randomUUID(),
    'noise',
    1120,
    JSON.stringify({ runner: 'noise_zone_sim.cjs', simulatedSwipes: 5000, touchAcceptGainPts: 4.3 }),
    isoAgo(5.8)
  );
  insLab.run(
    crypto.randomUUID(),
    'browser_e2e',
    1650,
    JSON.stringify({ suite: 'tma_viewport_hud_smoke', viewportsTested: ['390x844', '360x800', '1440x900'], failed: 0 }),
    isoAgo(5.5)
  );

  const insAb = db.prepare(
    `INSERT INTO ab_experiments
     (id, slug, hypothesis, status, rules_patch_json, control_sessions, treatment_sessions, control_contact_rate, treatment_contact_rate, control_d1_pct, treatment_d1_pct, p_value, winner, created_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  );
  insAb.run(
    'ab_oval_touch_plus8',
    'oval_touch_plus8',
    'Расширение мобильного овала ovalForwardMaxPx 120->128 и contactSideTouchPx 64->70 снизит OUTSIDE_ZONE без роста ложных зацепов',
    JSON.stringify({ ovalForwardMaxPx: 128, contactSideTouchPx: 70 }),
    640,
    655,
    68.4,
    74.9,
    41.2,
    44.8,
    0.0094,
    isoAgo(96)
  );
  insAb.run(
    'ab_serve_grace_plus4',
    'serve_grace_plus4',
    'Увеличение serveCaptureRadius на подаче с 0.55 до 0.60 улучшит завершение обучения у новичков',
    JSON.stringify({ serveCaptureRadius: 0.60 }),
    180,
    175,
    71.0,
    72.4,
    42.0,
    42.6,
    0.381,
    isoAgo(32)
  );

  // 12. Seed Incidents & Blameless Post-Mortem
  const incOpenId = 'inc_android_webgl_01';
  const incResolvedId = 'inc_eu_relay_resolved';
  db.prepare(
    `INSERT INTO incidents (id, severity, zone, title, description, runbook_slug, status, created_at)
     VALUES (?, 'warning', 'ops', ?, ?, 'rb-webgl-context-loss', 'open', ?)`
  ).run(
    incOpenId,
    'Повышенный RTT (>100 мс) и единичные потери WebGL на бюджетных Android в мобильной сети 4G',
    'Зафиксирована доля сессий в коридоре 100–150 мс и WebGL context loss при сворачивании Telegram Mini App.',
    isoAgo(5)
  );
  db.prepare(
    `INSERT INTO incidents (id, severity, zone, title, description, runbook_slug, status, ack_by, created_at, ack_at, resolved_at)
     VALUES (?, 'critical', 'ops', ?, ?, 'rb-high-ping-tma', 'resolved', 'owner@topspin.arena', ?, ?, ?)`
  ).run(
    incResolvedId,
    'Кратковременный скачок RTT до 145 мс на узле eu-fra-tma',
    'Перегрузка маршрута у транзитного оператора в регионе EU.',
    isoAgo(78),
    isoAgo(77.8),
    isoAgo(77.1)
  );

  db.prepare(
    `INSERT INTO postmortems
     (id, incident_id, blameless_summary, timeline_md, root_cause, impact, fix_applied, action_items_json, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'owner@topspin.arena', ?)`
  ).run(
    crypto.randomUUID(),
    incResolvedId,
    'Разбор без поиска виноватых (Blameless Post-Mortem): деградация маршрута транзитного провайдера во Франкфурте была автоматически смягчена буфером rollback-предсказания.',
    '- 14:10 UTC: Алерт p99 > 2σ в Ops\n- 14:18 UTC: Привязка новых сессий переключена на резервный relay\n- 14:52 UTC: Полное восстановление RTT < 45 мс',
    'Потеря 1.8% пакетов на внешнем пиринге провайдера.',
    'Затронуто 9% EU-сессий в течение 42 минут; обрывов активных матчей благодаря session affinity не произошло.',
    'Включён автоматический health-check переключения EU-узла при RTT p95 > 100 мс.',
    JSON.stringify([
      'Держать порог клиентского предупреждения пинга строго > 100 мс (13-telegram-miniapp-latency.md)',
      'Проверять токен привязки сессии (affinityToken) в интеграционных тестах',
    ]),
    isoAgo(72)
  );

  // 13. Seed News, Priority Pushes, Support Tickets (with screenshot + status history), Feedback Loop, Patch Pipeline & 6–12m LiveOps Calendar
  db.prepare(
    `INSERT INTO push_notifications
     (id, priority, pinned, title_ru, body_ru, title_en, body_en, segment, sent_count, created_by, created_at)
     VALUES (?, 'important', 1, ?, ?, ?, ?, 'all', 120, 'owner@topspin.arena', ?)`
  ).run(
    crypto.randomUUID(),
    '🏓 Открыт Кубок Осени TOPSPIN ARENA!',
    'Сыграйте 5 рейтинговых партий до воскресенья и получите неоновую накладку без влияния на физику.',
    '🏓 TOPSPIN ARENA Autumn Cup Is Live!',
    'Play 5 ranked matches before Sunday to unlock the cosmetic Neon Rubber tint.',
    isoAgo(20)
  );

  const newsItems = [
    ['update', 'Обновление баланса MATCH_RULES v4 и телеметрии 6 зон стола', 'Зафиксирован честный единый профиль овала нажатий и серверная проверка свежести свайпа.', 'MATCH_RULES v4 & 6-Zone Court Analytics Live', 'Unified fair-play input oval and server-side fresh-swipe validation are active.'],
    ['tournament', 'Еженедельный блиц-турнир в Telegram Mini App', 'Серии до 11 очков, региональный подбор серверов с пингом < 65 мс.', 'Weekly TMA Blitz Cup', '11-point sets with regional low-latency routing (< 65 ms).'],
  ];
  for (const n of newsItems) {
    db.prepare(
      `INSERT INTO news_posts (id, category, title_ru, body_ru, title_en, body_en, published, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'owner@topspin.arena', ?, ?)`
    ).run(crypto.randomUUID(), n[0], n[1], n[2], n[3], n[4], isoAgo(30), isoAgo(30));
  }

  // Support ticket with screenshot attachment + linked incident + status history
  const t1 = 'tkt_demo_001';
  db.prepare(
    `INSERT INTO support_tickets
     (id, player_id, region, session_id, category, priority, subject, status, linked_incident_id, screenshot_meta_json, client_context_json, created_at, updated_at)
     VALUES (?, 'plr_0012', 'RU', ?, 'bug', 'high', ?, 'open', ?, ?, ?, ?, ?)`
  ).run(
    t1,
    sessions[10].id,
    'Иногда не срабатывает удар с бэкхенда в дальнем левом углу (deep_bh)',
    incOpenId,
    JSON.stringify({ name: 'deep_bh_swipe_screen.png', sizeChars: 18420, previewDataUrl: null }),
    JSON.stringify({ platform: 'tma_android', rttMs: 74, grip: 'shakehand', hand: 'right', rulesVersion: 4 }),
    isoAgo(4),
    isoAgo(4)
  );
  db.prepare(
    `INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, body, attachment_name, created_at)
     VALUES (?, ?, 'player', 'Player_1012', ?, 'deep_bh_swipe_screen.png', ?)`
  ).run(crypto.randomUUID(), t1, 'При резком переводе мяча в дальний бэкхенд пишет OUTSIDE_ZONE, прикладываю скриншот.', isoAgo(4));
  db.prepare(
    `INSERT INTO support_ticket_events (id, ticket_id, from_status, to_status, actor, note, created_at)
     VALUES (?, ?, NULL, 'open', 'plr_0012', 'Создан тикет со скриншотом и автопривязкой к инциденту Ops', ?)`
  ).run(crypto.randomUUID(), t1, isoAgo(4));

  // Player Feedback Loop (collect -> sort -> prioritize -> respond — 15-liveops-content-plan.md)
  const feedbackRows = [
    ['support_tickets', 'controls', 'Расширить мобильный touch-овал на 6–8 пкс для ударов в движении', 48, 92, 'prioritized', 'Проверяем вариант +8 пкс в A/B-тесте oval_touch_plus8 (p=0.0094)', 'v0.9.2'],
    ['telegram_community', 'controls', 'Добавить визуальную подсветку причины отказа (NO_FRESH_SWIPE vs OUTSIDE_ZONE) в тренировке', 31, 84, 'responded', 'Включено в ТЗ нового клиента (экран тренировки)', 'v1.0.0'],
    ['store_reviews', 'visuals', 'Облегчить шейдеры неона на бюджетных Android при FPS < 45', 22, 76, 'sorted', null, 'v0.9.1-hotfix'],
    ['in_game_survey', 'liveops', 'Парные клубные турниры выходного дня без Pay-to-Win бустеров', 19, 65, 'collected', null, 'Season-2'],
  ];
  const insFb = db.prepare(
    `INSERT INTO player_feedback
     (id, source, category, summary, votes, priority_score, stage, public_response, target_patch_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const fb of feedbackRows) {
    insFb.run(crypto.randomUUID(), fb[0], fb[1], fb[2], fb[3], fb[4], fb[5], fb[6], fb[7], isoAgo(36), isoAgo(12));
  }

  // Patch Pipeline: Day-1 hotfix, Week-1 patch, Bi-weekly update, Beta branch (15-liveops-content-plan.md)
  const patches = [
    ['v0.9.1-day1', 'day1_hotfix', 'deployed', 'Day-1 хотфикс освобождения WebGL-текстур и тайм-аута сокета TMA', 'Day-1 WebGL context release & TMA socket keep-alive hotfix', isoAgo(120).slice(0, 10)],
    ['v0.9.2-week1', 'week1_patch', 'staged', 'Week-1 патч: калибровка touch-овала по итогам A/B и улучшение отклика подачи', 'Week-1 touch oval calibration & serve grace tuning', isoAhead(48).slice(0, 10)],
    ['v0.9.4-biweekly', 'biweekly_update', 'qa', 'Двухнедельный апдейт: Сезон 1 «Неоновая подача», новые косметические основания', 'Bi-weekly update: Season 1 Neon Serve & cosmetic blades', isoAhead(240).slice(0, 10)],
    ['v1.0.0-client-beta', 'beta_branch', 'planned', 'Закрытая бета полностью переписанного клиента TOPSPIN ARENA с прямым подключением к CRM API', 'Closed beta of the clean-sheet TOPSPIN ARENA client integrated with CRM API', isoAhead(600).slice(0, 10)],
  ];
  const insPatch = db.prepare(
    `INSERT INTO patch_pipeline (id, version, track, status, changelog_ru, changelog_en, target_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const pt of patches) {
    insPatch.run(crypto.randomUUID(), pt[0], pt[1], pt[2], pt[3], pt[4], pt[5], isoAgo(48));
  }

  // 6–12 Month LiveOps Content Roadmap (15-liveops-content-plan.md)
  const roadmap = [
    ['Сезон 1: Неоновая подача (Месяц 1–2)', 'season', isoAgo(24), isoAhead(24 * 45), { cosmetics: 12, p2w: false }, 'active'],
    ['Блиц-кубок Telegram Stars (Еженедельный)', 'tournament', isoAhead(24 * 3), isoAhead(24 * 5), { bracket: 64, entryCoins: 500 }, 'scheduled'],
    ['Зимний Фестиваль Вращения (Месяц 3–4)', 'holiday', isoAhead(24 * 50), isoAhead(24 * 75), { arenaTheme: 'ice_cyber', quests: 15 }, 'scheduled'],
    ['Сезон 2: Мастера Пера и Шейкхенда (Месяц 5–6)', 'season', isoAhead(24 * 90), isoAhead(24 * 150), { cosmetics: 16, gripChallenges: true }, 'scheduled'],
    ['Летний Гран-При СНГ & Европы (Месяц 7–9)', 'tournament', isoAhead(24 * 180), isoAhead(24 * 240), { regionalFinals: ['RU', 'EU', 'KZ'] }, 'scheduled'],
    ['Годовщина TOPSPIN ARENA — Мировая Лига (Месяц 10–12)', 'season', isoAhead(24 * 280), isoAhead(24 * 355), { anniversarySkins: true }, 'scheduled'],
  ];
  const insCal = db.prepare(
    `INSERT INTO liveops_events (id, title, event_type, starts_at, ends_at, config_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const ev of roadmap) {
    insCal.run(crypto.randomUUID(), ev[0], ev[1], ev[2], ev[3], JSON.stringify(ev[4]), ev[5], isoAgo(72));
  }

  // 14. Seed Director Persistent State + >72h Old Messages (moved into separate `director-archive.sqlite`!) + Fresh Active Chat
  db.prepare(
    `INSERT OR REPLACE INTO director_state (key, value_json, updated_at)
     VALUES ('priorities', ?, ?)`
  ).run(
    JSON.stringify([
      'Снизить долю OUTSIDE_ZONE на мобильных touch-экранах и в зоне deep_bh без упрощения геймплея',
      'Удерживать RTT p95 < 100 мс в Telegram Mini App по всем регионам',
      'Обеспечить 100% готовность API и документации к подключению нового игрового клиента',
    ]),
    isoAgo(6)
  );

  // Insert 2 historical >72h messages (~95h ago) and immediately run `moveExpiredDirectorChatToArchiveDb`
  const insDirChat = db.prepare(
    `INSERT INTO director_chat (id, owner_id, region, role, content, structured_json, archived, created_at)
     VALUES (?, 'owner@topspin.arena', ?, ?, ?, ?, 0, ?)`
  );
  insDirChat.run(
    'dir_old_owner_1',
    CONFIG.primaryRegion,
    'owner',
    'Какой статус был по европейскому релею на прошлой неделе?',
    null,
    isoAgo(96)
  );
  insDirChat.run(
    'dir_old_reply_1',
    CONFIG.primaryRegion,
    'director',
    'Кратковременный скачок пинга на eu-fra-tma был устранён переключением маршрута; проведён blameless post-mortem.',
    JSON.stringify({
      status: 'ok',
      summary: 'Инцидент eu-fra-tma закрыт, потерь активных партий не допущено.',
      findings: [],
      next_questions: ['Проверить свежую сводку Ops'],
    }),
    isoAgo(95.9)
  );

  // Move >72h messages out of active DB into `data/director-archive.sqlite`!
  moveExpiredDirectorChatToArchiveDb(db);

  // Run all 5 isolated AI zone workers so fresh validated ZoneSummaries & HITL proposals exist immediately
  await runOpsZoneAnalysis(db);
  await runFraudZoneAnalysis(db);
  await runBalanceZoneAnalysis(db);
  await runMarketZoneAnalysis(db);
  await runLabZoneAnalysis(db);

  // Seed one recent active Director exchange inside the 72h window
  insDirChat.run(
    'dir_recent_owner_1',
    CONFIG.primaryRegion,
    'owner',
    'Дай утреннюю сводку по всем 5 зонам перед стартом смены.',
    null,
    isoAgo(3)
  );
  insDirChat.run(
    'dir_recent_reply_1',
    CONFIG.primaryRegion,
    'director',
    'Все 5 изолированных зон сформировали свежие сводки: в Lab готов статистически значимый победитель A/B по touch-овалу (+6.5 п.п. контакта, p=0.0094), во Fraud ждут ручной проверки кейсы 24/7 и макросов, в Market найдена одна убыточная кампания VK Clips.',
    JSON.stringify({
      status: 'warning',
      summary:
        'Требуют внимания владельца предложения HITL в зонах Balance/Lab (расширение touch-овала), Fraud (ручной разбор ботов) и Market (остановка убыточной кампании).',
      findings: [
        {
          zone: 'lab',
          issue: "A/B эксперимент 'oval_touch_plus8' победил контроль (+6.5 п.п. контакта, p=0.0094)",
          confidence: 0.93,
          recommended_action: 'Подтвердить выкатку правил в блоке предложений HITL',
        },
        {
          zone: 'fraud',
          issue: 'Открыты антифрод-кейсы высокого риска (макрос, 24/7 активность, скорость платежей)',
          confidence: 0.91,
          recommended_action: 'Провести ручную проверку во вкладке Fraud',
        },
      ],
      next_questions: [
        'Покажи сложность ударов по 6 зонам стола в Balance',
        'Какие антифрод-детекторы сработали за последние сутки?',
        'Готова ли система по чек-листу запуска из 10-checklist.md?',
      ],
    }),
    isoAgo(2.98)
  );

  // Demo data is a system action, not an operator decision — record it once so the
  // audit trail starts with a legible genesis instead of an unexplained dataset.
  try {
    const { writeAuditLog } = require('../security/audit');
    writeAuditLog(db, {
      actorRole: 'system',
      actorId: 'seed',
      action: 'system.seed.completed',
      targetType: 'database',
      targetId: 'demo_dataset',
      applied: { players: players.length, sessions: sessions.length, mode: force ? 'force-reset' : 'initial' },
    });
  } catch {
    /* seeding must not fail because auditing is unavailable */
  }

  return {
    seeded: true,
    players: players.length,
    sessions: sessions.length,
  };
}

module.exports = {
  seedDatabaseIfEmpty,
};
