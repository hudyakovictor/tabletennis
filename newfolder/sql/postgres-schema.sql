-- ============================================================================
-- TOPSPIN ARENA — Production PostgreSQL 8-Schema Migration (01-architecture, 06-data-schema)
-- Full parity with SQLite runtime schema + DB-level RBAC grants + Anonymized Zone Views
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS players;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS balance;
CREATE SCHEMA IF NOT EXISTS fraud;
CREATE SCHEMA IF NOT EXISTS market;
CREATE SCHEMA IF NOT EXISTS lab;
CREATE SCHEMA IF NOT EXISTS director;

-- Isolated PostgreSQL Roles (04-security.md)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_zone_ops') THEN CREATE ROLE ai_zone_ops NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_zone_fraud') THEN CREATE ROLE ai_zone_fraud NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_zone_balance') THEN CREATE ROLE ai_zone_balance NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_zone_market') THEN CREATE ROLE ai_zone_market NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_zone_lab') THEN CREATE ROLE ai_zone_lab NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_director') THEN CREATE ROLE ai_director NOLOGIN; END IF;
END $$;

CREATE TABLE IF NOT EXISTS players.players (
  id TEXT PRIMARY KEY,
  external_id_hash TEXT,
  display_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'RU',
  install_source TEXT NOT NULL DEFAULT 'organic_tma',
  install_campaign TEXT,
  install_creative TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  ban_reason TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Anonymized Zone Projections (Zero PII granted to AI zones)
CREATE OR REPLACE VIEW balance.v_balance_players AS
  SELECT id AS player_id, region, status FROM players.players WHERE status <> 'deleted';

CREATE OR REPLACE VIEW fraud.v_fraud_players AS
  SELECT id AS player_id, ('anon_' || right(id, 6)) AS player_alias, region, status, created_at
  FROM players.players WHERE status <> 'deleted';

CREATE OR REPLACE VIEW market.v_market_players AS
  SELECT id AS player_id, region, install_source, install_campaign, install_creative, created_at
  FROM players.players WHERE status <> 'deleted';

CREATE TABLE IF NOT EXISTS ops.sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  region TEXT NOT NULL DEFAULT 'RU',
  platform TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  ip_hash TEXT,
  affinity_token TEXT,
  rtt_p50_ms DOUBLE PRECISION DEFAULT 42,
  rtt_p95_ms DOUBLE PRECISION DEFAULT 85,
  avg_fps DOUBLE PRECISION DEFAULT 60,
  p5_fps DOUBLE PRECISION DEFAULT 54,
  crashed BOOLEAN NOT NULL DEFAULT FALSE,
  webgl_lost BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS balance.input_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  player_id TEXT,
  ts TIMESTAMPTZ NOT NULL,
  pointer_type TEXT NOT NULL,
  grip TEXT NOT NULL,
  hand TEXT NOT NULL,
  is_serve BOOLEAN NOT NULL DEFAULT FALSE,
  table_zone TEXT NOT NULL DEFAULT 'deep_fh',
  has_fresh_swipe BOOLEAN NOT NULL DEFAULT TRUE,
  swipe_straightness DOUBLE PRECISION DEFAULT 0.88,
  along DOUBLE PRECISION NOT NULL,
  across DOUBLE PRECISION NOT NULL,
  accepted BOOLEAN NOT NULL,
  contact BOOLEAN NOT NULL DEFAULT FALSE,
  is_grace BOOLEAN NOT NULL DEFAULT FALSE,
  reject_code TEXT,
  stroke_type TEXT,
  ball_speed DOUBLE PRECISION DEFAULT 0,
  spin DOUBLE PRECISION DEFAULT 0,
  reaction_ms DOUBLE PRECISION,
  sweet_spot_dist DOUBLE PRECISION,
  rules_version INTEGER NOT NULL DEFAULT 4,
  ab_variant TEXT
);

CREATE TABLE IF NOT EXISTS balance.match_rules_versions (
  version INTEGER PRIMARY KEY,
  rules_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  comment TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fraud.fraud_cases (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  region TEXT NOT NULL DEFAULT 'RU',
  risk_score DOUBLE PRECISION NOT NULL,
  case_type TEXT NOT NULL,
  signals_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  reviewed_by TEXT,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments.payments (
  id TEXT PRIMARY KEY,
  player_id TEXT,
  region TEXT NOT NULL DEFAULT 'RU',
  amount_usd NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,
  item_sku TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded',
  billing_country TEXT,
  session_country TEXT,
  risk_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market.marketing_campaigns (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  campaign TEXT NOT NULL,
  creative TEXT NOT NULL,
  spend_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  installs BIGINT NOT NULL DEFAULT 0,
  paying_users BIGINT NOT NULL DEFAULT 0,
  d1_retained BIGINT NOT NULL DEFAULT 0,
  d7_retained BIGINT NOT NULL DEFAULT 0,
  d30_retained BIGINT NOT NULL DEFAULT 0,
  revenue_d30_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab.lab_runs (
  id TEXT PRIMARY KEY,
  suite TEXT NOT NULL,
  git_branch TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  summary_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab.ab_experiments (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  hypothesis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  rules_patch_json JSONB NOT NULL,
  control_sessions INTEGER NOT NULL DEFAULT 0,
  treatment_sessions INTEGER NOT NULL DEFAULT 0,
  control_contact_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  treatment_contact_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  control_d1_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  treatment_d1_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  p_value DOUBLE PRECISION,
  winner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS director.zone_summaries (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json JSONB NOT NULL,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS director.director_chat (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'RU',
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  structured_json JSONB,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Strict Schema-Level Isolation Grants (Zero access to players.players for any AI role!)
REVOKE ALL ON SCHEMA players FROM ai_zone_ops, ai_zone_fraud, ai_zone_balance, ai_zone_market, ai_zone_lab, ai_director;
GRANT USAGE ON SCHEMA ops TO ai_zone_ops;
GRANT SELECT ON ALL TABLES IN SCHEMA ops TO ai_zone_ops;
GRANT USAGE ON SCHEMA fraud TO ai_zone_fraud;
GRANT SELECT ON ALL TABLES IN SCHEMA fraud TO ai_zone_fraud;
GRANT USAGE ON SCHEMA balance TO ai_zone_balance;
GRANT SELECT ON ALL TABLES IN SCHEMA balance TO ai_zone_balance;
GRANT USAGE ON SCHEMA market TO ai_zone_market;
GRANT SELECT ON ALL TABLES IN SCHEMA market TO ai_zone_market;
GRANT USAGE ON SCHEMA lab TO ai_zone_lab;
GRANT SELECT ON ALL TABLES IN SCHEMA lab TO ai_zone_lab;
GRANT USAGE ON SCHEMA director TO ai_director;
GRANT SELECT ON director.zone_summaries, director.director_chat TO ai_director;
