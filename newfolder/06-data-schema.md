# Схема данных

## Общий принцип

На старте используется одна БД в РФ.

Схемы уже разделены по зонам и по регионам.

Это позволит позже разделить данные без полной переделки.

## Схемы

- `players`
- `payments`
- `ops`
- `fraud`
- `balance`
- `market`
- `lab`
- `director`

## Таблица players

```sql
CREATE TABLE players (
  id UUID PRIMARY KEY,
  region VARCHAR(8) NOT NULL,
  email_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL,
  consent_telemetry BOOLEAN DEFAULT FALSE,
  consent_ai_analysis BOOLEAN DEFAULT FALSE,
  device_fingerprint_hash VARCHAR(64),
  country_code VARCHAR(2)
);
```

## Таблица game_sessions

```sql
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id),
  region VARCHAR(8) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  device_type VARCHAR(16),
  fps_avg REAL,
  crash BOOLEAN DEFAULT FALSE
);
```

## Таблица input_logs

```sql
CREATE TABLE input_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES game_sessions(id),
  region VARCHAR(8) NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  pointer_type VARCHAR(16),
  along REAL,
  across REAL,
  reject_code VARCHAR(32),
  ball_speed REAL,
  spin REAL
);
```

## Таблица ai_requests

```sql
CREATE TABLE ai_requests (
  id UUID PRIMARY KEY,
  zone VARCHAR(16) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  model VARCHAR(64) NOT NULL,
  prompt_tokens INT,
  completion_tokens INT,
  cost_usd NUMERIC(10,6),
  status VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL
);
```

## Таблица director_chat

```sql
CREATE TABLE director_chat (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL,
  role VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  archived BOOLEAN DEFAULT FALSE
);
```

## Региональное партиционирование

Все таблицы с ПДн имеют поле `region`.

Позже это позволит:

- разделить БД по регионам;
- роутить запросы по гео-IP;
- реплицировать только агрегаты;
- не передавать ПДн между регионами.

## Retention

- сырые логи ввода: 90 дней;
- телеметрия: 180 дней;
- логи ИИ: 180 дней;
- чат с директором: 365 дней;
- платёжные данные: по требованию закона.

По истечении срока — удаление или анонимизация.
