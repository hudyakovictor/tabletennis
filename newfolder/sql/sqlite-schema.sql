-- ============================================================================
-- TOPSPIN ARENA — Embedded SQLite Schema v2 (8 Logical Domains + Anonymized Views)
-- Strict PII Minimization: AI zones read ONLY anonymized SQL views (v_balance_players,
-- v_fraud_players, v_market_players) and NEVER access raw `players`.
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  display_name TEXT NOT NULL,
  last_login_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  disabled_at TEXT,
  disabled_by TEXT,
  created_at TEXT NOT NULL
);

-- ============================================================================
-- Domain 1: players (PII isolated here; raw table blocked for all AI gateways)
-- ============================================================================
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  external_id_hash TEXT,
  display_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'RU',
  install_source TEXT NOT NULL DEFAULT 'organic_tma',
  install_campaign TEXT,
  install_creative TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended | banned | deleted
  ban_reason TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_region_status ON players(region, status);

-- Anonymized SQL Projections for AI Zones (Zero external_id_hash, zero real display_name!)
CREATE VIEW IF NOT EXISTS v_balance_players AS
SELECT
  id AS player_id,
  region,
  status
FROM players
WHERE status != 'deleted';

CREATE VIEW IF NOT EXISTS v_fraud_players AS
SELECT
  id AS player_id,
  'anon_' || substr(id, -6) AS player_alias,
  region,
  status,
  created_at
FROM players
WHERE status != 'deleted';

CREATE VIEW IF NOT EXISTS v_market_players AS
SELECT
  id AS player_id,
  region,
  install_source,
  install_campaign,
  install_creative,
  created_at
FROM players
WHERE status != 'deleted';

-- ============================================================================
-- Domain 2: ops & telemetry
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  region TEXT NOT NULL DEFAULT 'RU',
  platform TEXT NOT NULL DEFAULT 'tma_ios',
  device_hash TEXT NOT NULL,
  ip_hash TEXT,
  affinity_token TEXT,
  rtt_p50_ms REAL DEFAULT 42,
  rtt_p95_ms REAL DEFAULT 85,
  avg_fps REAL DEFAULT 60,
  p5_fps REAL DEFAULT 54,
  crashed INTEGER NOT NULL DEFAULT 0,
  webgl_lost INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_hash);

CREATE TABLE IF NOT EXISTS telemetry_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_ts TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_telemetry_metric_ts ON telemetry_metrics(metric_name, bucket_ts);

-- ============================================================================
-- Domain 3: balance (Input telemetry, 6-zone table map, MATCH_RULES versions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS input_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_event_id TEXT,
  session_id TEXT NOT NULL,
  player_id TEXT,
  ts TEXT NOT NULL,
  pointer_type TEXT NOT NULL DEFAULT 'touch',
  grip TEXT NOT NULL DEFAULT 'shakehand',
  hand TEXT NOT NULL DEFAULT 'right',
  is_serve INTEGER NOT NULL DEFAULT 0,
  table_zone TEXT NOT NULL DEFAULT 'deep_fh',
  has_fresh_swipe INTEGER NOT NULL DEFAULT 1,
  swipe_straightness REAL DEFAULT 0.88,
  along REAL NOT NULL,
  across REAL NOT NULL,
  accepted INTEGER NOT NULL,
  contact INTEGER NOT NULL DEFAULT 0,
  is_grace INTEGER NOT NULL DEFAULT 0,
  reject_code TEXT,
  stroke_type TEXT,
  ball_speed REAL DEFAULT 0,
  spin REAL DEFAULT 0,
  reaction_ms REAL,
  sweet_spot_dist REAL,
  rules_version INTEGER NOT NULL DEFAULT 4,
  ab_variant TEXT
);
CREATE INDEX IF NOT EXISTS idx_input_ts ON input_events(ts);
CREATE INDEX IF NOT EXISTS idx_input_zone ON input_events(table_zone, accepted);
CREATE INDEX IF NOT EXISTS idx_input_player ON input_events(player_id, accepted);
-- Idempotent telemetry: a retried client batch can never double-count a stroke
CREATE UNIQUE INDEX IF NOT EXISTS uq_input_client_event ON input_events(session_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS match_rules_versions (
  version INTEGER PRIMARY KEY,
  rules_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ============================================================================
-- Domain 4: fraud (Zero Auto-Bans; Human review required)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fraud_cases (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  region TEXT NOT NULL DEFAULT 'RU',
  risk_score REAL NOT NULL,
  case_type TEXT NOT NULL,
  signals_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | confirmed_fraud | false_positive
  reviewed_by TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_fraud_status_risk ON fraud_cases(status, risk_score DESC);

-- ============================================================================
-- Domain 5: payments & market (Unit economics, cohorts, sink/source ledger)
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  player_id TEXT, -- Set to NULL on GDPR/152-FZ erasure while preserving tax record!
  region TEXT NOT NULL DEFAULT 'RU',
  amount_usd REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XTR',
  provider TEXT NOT NULL DEFAULT 'telegram_stars',
  item_sku TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded',
  billing_country TEXT DEFAULT 'RU',
  session_country TEXT DEFAULT 'RU',
  risk_flag INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_player ON payments(player_id, created_at);

CREATE TABLE IF NOT EXISTS ad_events (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  placement TEXT NOT NULL,
  network TEXT NOT NULL,
  revenue_usd REAL NOT NULL,
  rewarded INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS economy_ledger (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  currency TEXT NOT NULL, -- coins | gems
  delta INTEGER NOT NULL,
  amount INTEGER GENERATED ALWAYS AS (ABS(delta)) VIRTUAL,
  flow_type TEXT NOT NULL, -- source | sink
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  campaign TEXT NOT NULL,
  creative TEXT NOT NULL,
  spend_usd REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  installs INTEGER NOT NULL DEFAULT 0,
  paying_users INTEGER NOT NULL DEFAULT 0,
  d1_retained INTEGER NOT NULL DEFAULT 0,
  d7_retained INTEGER NOT NULL DEFAULT 0,
  d30_retained INTEGER NOT NULL DEFAULT 0,
  revenue_d30_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- ============================================================================
-- Domain 6: lab (Calibrate / Noise benches & Statistical A/B)
-- ============================================================================
CREATE TABLE IF NOT EXISTS lab_runs (
  id TEXT PRIMARY KEY,
  suite TEXT NOT NULL, -- calibrate | noise | browser_e2e
  git_branch TEXT NOT NULL,
  status TEXT NOT NULL, -- passed | warning | failed
  duration_ms INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ab_experiments (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  hypothesis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | stopped
  rules_patch_json TEXT NOT NULL,
  control_sessions INTEGER NOT NULL DEFAULT 0,
  treatment_sessions INTEGER NOT NULL DEFAULT 0,
  control_contact_rate REAL NOT NULL DEFAULT 0,
  treatment_contact_rate REAL NOT NULL DEFAULT 0,
  control_d1_pct REAL NOT NULL DEFAULT 0,
  treatment_d1_pct REAL NOT NULL DEFAULT 0,
  p_value REAL,
  winner TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

-- ============================================================================
-- Domain 7: AI Governance, Zone Summaries, HITL Proposals & Director Layer
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_zone_configs (
  zone TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  fallback_provider TEXT NOT NULL DEFAULT 'local_statistical',
  model TEXT NOT NULL,
  daily_token_limit INTEGER NOT NULL,
  zero_retention INTEGER NOT NULL DEFAULT 1,
  batch_mode INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  api_key_encrypted TEXT,
  api_key_fingerprint TEXT,
  api_key_updated_at TEXT,
  api_key_updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'RU',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  is_batch INTEGER NOT NULL DEFAULT 0,
  zero_retention INTEGER NOT NULL DEFAULT 1,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL, -- ok | quarantined | budget_exceeded
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_zone_day ON ai_requests(zone, created_at);

CREATE TABLE IF NOT EXISTS ai_quarantine (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  provider TEXT NOT NULL,
  reason TEXT NOT NULL,
  raw_output TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zone_summaries (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  status TEXT NOT NULL, -- ok | warning | critical
  summary_json TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zone_summaries_zone_created ON zone_summaries(zone, created_at DESC);

CREATE TABLE IF NOT EXISTS director_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS director_chat (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'RU',
  role TEXT NOT NULL, -- owner | director
  content TEXT NOT NULL,
  structured_json TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_director_chat_created ON director_chat(created_at);

CREATE TABLE IF NOT EXISTS action_proposals (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.85,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | applied | rejected
  decided_by TEXT,
  decision_comment TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

-- ============================================================================
-- Domain 8: Observability, Maintenance, Push, News, Support, LiveOps & Legal
-- ============================================================================
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL DEFAULT 'warning', -- info | warning | critical
  zone TEXT NOT NULL DEFAULT 'ops',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  runbook_slug TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | acknowledged | resolved
  ack_by TEXT,
  created_at TEXT NOT NULL,
  ack_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS postmortems (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  blameless_summary TEXT NOT NULL,
  timeline_md TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  impact TEXT NOT NULL,
  fix_applied TEXT NOT NULL,
  action_items_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_notifications (
  id TEXT PRIMARY KEY,
  priority TEXT NOT NULL DEFAULT 'normal', -- normal | important | critical
  pinned INTEGER NOT NULL DEFAULT 0,
  title_ru TEXT NOT NULL,
  body_ru TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body_en TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT 'all',
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS news_posts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'update',
  title_ru TEXT NOT NULL,
  body_ru TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body_en TEXT NOT NULL,
  image_url TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  region TEXT NOT NULL DEFAULT 'RU',
  session_id TEXT,
  category TEXT NOT NULL DEFAULT 'bug',
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high | critical
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | in_progress | answered | closed
  linked_incident_id TEXT,
  screenshot_meta_json TEXT,
  client_context_json TEXT NOT NULL DEFAULT '{}',
  first_response_at TEXT,
  first_response_minutes INTEGER,
  sla_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL, -- player | admin
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  attachment_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_feedback (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'crm',
  category TEXT NOT NULL DEFAULT 'controls',
  summary TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 1,
  priority_score INTEGER NOT NULL DEFAULT 50,
  stage TEXT NOT NULL DEFAULT 'collected', -- collected | sorted | prioritized | responded
  public_response TEXT,
  target_patch_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patch_pipeline (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  track TEXT NOT NULL DEFAULT 'biweekly_update', -- day1_hotfix | week1_patch | biweekly_update | beta_branch
  status TEXT NOT NULL DEFAULT 'qa', -- planned | qa | staged | deployed | rolled_back
  changelog_ru TEXT NOT NULL,
  changelog_en TEXT NOT NULL,
  target_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS liveops_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL, -- season | tournament | holiday | patch | quest
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legal_documents (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL, -- tos | privacy_policy | eula | cookie_policy
  version TEXT NOT NULL,
  lang TEXT NOT NULL, -- ru | en
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  requires_reconsent INTEGER NOT NULL DEFAULT 1,
  published_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_dpa_registry (
  provider TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  dpa_status TEXT NOT NULL DEFAULT 'signed',
  zero_data_retention INTEGER NOT NULL DEFAULT 1,
  pii_allowed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_consents (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'RU',
  doc_type TEXT NOT NULL,
  doc_version TEXT NOT NULL,
  declared_age INTEGER NOT NULL DEFAULT 18,
  is_minor INTEGER NOT NULL DEFAULT 0,
  parental_consent INTEGER NOT NULL DEFAULT 0,
  analytics_opt_in INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  consented_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'RU',
  request_type TEXT NOT NULL, -- export | erasure
  status TEXT NOT NULL DEFAULT 'completed', -- pending | in_progress | completed | rejected
  reason TEXT,
  requested_at TEXT NOT NULL,
  due_at TEXT,               -- requested_at + 30 days (152-ФЗ / GDPR Art. 12(3))
  completed_at TEXT,
  processed_by TEXT,
  source TEXT,               -- operator | player_client
  notes TEXT,
  rejection_reason TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests(status, due_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL DEFAULT 'RU',
  actor_role TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  proposed_json TEXT,
  applied_json TEXT,
  data_refs_json TEXT,
  provider TEXT,
  model TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  prev_hash TEXT,
  entry_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
-- Restore checks ask "is this snapshot's head still part of the live chain?"
CREATE INDEX IF NOT EXISTS idx_audit_hash ON audit_logs(entry_hash);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at DESC);

-- ============================================================================
-- Domain 9 (v3): Session security, CSRF, Idempotency, Scheduler, Alerting,
-- Notification Center, Fraud review history & client push dismissals.
-- These tables close the "operator ergonomics + provable governance" gap:
-- every mutation is replay-safe, every alert is deduplicable, and every admin
-- session is individually revocable.
-- ============================================================================

-- Server-side admin session registry: JWT carries `sid`; revocation is instant.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  ip_hash TEXT,
  ua_hash TEXT,
  csrf_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_actor ON admin_sessions(actor_id, revoked_at);

-- Replay-safe admin mutations (`Idempotency-Key` header on POST/PUT/PATCH/DELETE)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);

-- Cadence engine for the 5 zones + platform jobs (02-ai-zones.md cadences)
CREATE TABLE IF NOT EXISTS scheduler_jobs (
  job_name TEXT PRIMARY KEY,
  zone TEXT,
  cadence_sec INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_finished_at TEXT,
  last_status TEXT,
  last_duration_ms INTEGER,
  last_error TEXT,
  next_run_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  per_run_token_budget INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'schedule', -- schedule | manual
  status TEXT NOT NULL,                     -- running | ok | skipped | failed
  detail_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_job_runs_name ON job_runs(job_name, started_at DESC);

-- Alert silencing: fingerprint = stable hash of (rule, zone, title)
CREATE TABLE IF NOT EXISTS alert_silences (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_silence_fp ON alert_silences(fingerprint, expires_at);

-- Operator notification center (SSE-backed, deduplicated, role-scoped)
CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY,
  fingerprint TEXT,
  kind TEXT NOT NULL,       -- incident | proposal | zone | ticket | maintenance | system | audit
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link_hash TEXT,
  target_roles_json TEXT NOT NULL DEFAULT '[]',
  read_at TEXT,
  read_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_notif_unread ON admin_notifications(read_at, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_notif_fp ON admin_notifications(fingerprint) WHERE fingerprint IS NOT NULL;

-- Human-only fraud review history (zero auto-bans; full sanction trail)
CREATE TABLE IF NOT EXISTS fraud_case_reviews (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  verdict TEXT NOT NULL,
  player_action TEXT NOT NULL DEFAULT 'none',
  note TEXT NOT NULL DEFAULT '',
  risk_score_before REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fraud_reviews_case ON fraud_case_reviews(case_id, created_at DESC);

-- Player-side dismissal of priority pushes (17-maintenance-push-news-support.md)
CREATE TABLE IF NOT EXISTS notification_dismissals (
  player_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (player_id, notification_id)
);

-- Short-lived WebSocket admission tickets (never reuse the long player token)
CREATE TABLE IF NOT EXISTS ws_tickets (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  session_id TEXT,
  region TEXT NOT NULL DEFAULT 'RU',
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
