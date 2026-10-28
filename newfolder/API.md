# API TOPSPIN ARENA CRM

Базовый URL: `https://<crm-host>`. Ответы JSON, timestamps ISO-8601 UTC. Ошибки: `{ "error": "…" }`.

## Авторизация

| Метод | Доступ | Назначение |
|---|---|---|
| `POST /api/auth/login` | public | username/password → HttpOnly session + CSRF |
| `GET /api/auth/me` | admin | пользователь, CSRF, публичный конфиг |
| `POST /api/auth/logout` | admin+CSRF | завершить сессию |
| `POST /api/auth/password` | admin+CSRF | сменить пароль, завершить все сессии |

Для всех admin `POST/PATCH/DELETE`: cookie + `X-CSRF-Token`.

## Public / ingestion / client

- `GET /api/health`
- `GET /api/ingest/schema`
- `POST /api/ingest/events` — HMAC, `{events:[]}`.
- `GET /api/client/config`
- `GET /api/client/feed`
- `POST /api/client/pushes/:id/read` — HMAC.
- `POST|GET /api/client/tickets`, `GET /api/client/tickets/:id` — HMAC.
- `POST /api/client/consents`, `POST /api/client/deletion` — HMAC.

Подпись: `x-tt-key`, `x-tt-timestamp`, `x-tt-signature`, `x-tt-nonce`; см. `INTEGRATION.ru.md`.

## Дашборды (admin)

| Endpoint | Данные |
|---|---|
| `GET /api/overview?range=7d` | KPI, графики, зоны, алерты |
| `GET /api/ops?range=24h` | golden signals, FPS, builds, errors, pings |
| `GET /api/balance?range=7d&device_type=touch&rules_version=4` | ввод, heatmap, сегменты |
| `GET /api/market?range=30d` | каналы, когорты, ROAS/LTV/CAC |
| `GET /api/economy?range=30d` | платежи, продукты, sink/source |
| `GET /api/events?type=input&player_id=…&limit=50` | сырые события для admin (не для директора) |
| `GET /api/export?entity=players&format=csv` | экспорт; также `payments`, `alerts`, `tickets`, `fraud_cases`, `ai_requests`, `audit_log`, `news`, `proposals` |

## Игроки

- `GET /api/players?search=&region=&status=&sort=created_at&dir=DESC&limit=50&offset=0`
- `GET /api/players/:id`
- `POST /api/players/:id/status` — `{status:'active'|'banned', reason}`.
- `POST /api/players/:id/consents` — consent flags.
- `POST /api/players/:id/delete-data` — `{confirm:'<player-id>'}`, необратимая анонимизация.

## Fraud

- `GET /api/fraud?range=7d`
- `GET /api/fraud/cases/:id`
- `POST /api/fraud/scan` — `{threshold:0.55}`.
- `POST /api/fraud/score/:playerId` — `{create_case:true}`.
- `POST /api/fraud/cases/:id/review` — `{status,note,ban}`. Бан только ручной.

## Lab

- `GET /api/lab?range=30d`
- `POST /api/lab/tests`, `PATCH /api/lab/tests/:id`, `DELETE /api/lab/tests/:id`
- `POST /api/lab/results` — `{test_id,variant,metric,value,sample_size}`.
- `POST /api/lab/reports`

## AI / директор

- `GET /api/ai?range=7d`
- `POST /api/ai/zones/run-all`
- `POST /api/ai/zones/:zone/run` — zone = `ops|fraud|balance|market|lab`.
- `GET /api/ai/summaries?zone=ops&limit=20`
- `POST /api/ai/quarantine/:id/resolve`
- `GET /api/director/context`
- `GET|POST /api/director/chat` — POST `{question}`.
- `POST /api/director/state` — `{key:'priorities'|'known_issues'|'notes',value}`.
- `POST /api/director/archive`
- `GET /api/decisions`, `POST /api/director/decisions`

## Предложения / алерты

- `GET /api/proposals?status=pending&zone=balance`
- `POST /api/proposals/:id/review` — `{decision:'approve'|'reject',note}`.
- `POST /api/proposals/:id/execute` — только после approve; whitelist действий.
- `GET /api/alerts?status=open`, `POST /api/alerts/evaluate`
- `POST /api/alerts/:id/status` — `{status:'open'|'ack'|'resolved'}`.
- `GET|POST /api/incidents`, `PATCH /api/incidents/:id`
- `GET /api/runbooks/:name`

## LiveOps

- `GET /api/liveops`
- `POST /api/maintenance` — `{enabled,text,eta}`; auto-push при смене.
- `GET|POST /api/news`, `PATCH|DELETE /api/news/:id`
- `GET|POST /api/pushes`
- `GET|POST /api/tickets`, `GET|PATCH /api/tickets/:id`
- `GET|POST /api/content`, `PATCH|DELETE /api/content/:id`

## Система

- `GET /api/settings`, `PATCH /api/settings` — только `feature_flags`, `match_rules`, `alert_thresholds`, `active_build`, `paused_campaigns`, `rules_version`.
- `GET /api/audit?limit=100`
- `GET /api/integration` — не содержит секретов.
- `POST /api/demo/seed` — наполнить пустую БД демо-данными; `{force:true}` только для тестовой среды.
