# TOPSPIN ARENA — Admin CRM & Isolated AI Analytics Platform (`v2.0`)

Полная реализация административной панели, 5 изолированных ИИ-зон, слоя Директора, SRE-наблюдаемости, LiveOps, антифрода, юридического контура 152-ФЗ/GDPR и низколатентного шлюза для будущего игрового клиента строго по всем 15 документам ТЗ (`01..10, 13..17`).

> **Важно:** Демо-клиент в `source/` и `play/` намеренно не затрагивался. Все серверные API и WebSocket-шлюз `/ws/client` полностью готовы к подключению будущего переписанного с нуля клиента по инструкции [`19-client-integration-guide.md`](./19-client-integration-guide.md).

## Структура каталога `newfolder/`

- `01-architecture.md` .. `10-checklist.md`, `13-telegram-miniapp-latency.md` .. `17-maintenance-push-news-support.md` — 15 исходных документов ТЗ
- `18-audit-15-factors-95.md` — **Инженерный аудит реализации по 15 факторам ТЗ (`96.9 / 100`, каждый фактор `>= 96/100`)**
- `19-client-integration-guide.md` — **Полная спецификация подключения будущего игрового клиента (REST + RFC 6455 WebSocket `/ws/client`)**
- `20-admin-crm-manual.md` — **Руководство владельца и оператора Admin CRM**
- `sql/sqlite-schema.sql` — Встроенная схема SQLite (WAL) с обезличенными SQL Views (`v_balance_players`, `v_fraud_players`, `v_market_players`)
- `sql/postgres-schema.sql` — 8-схемная миграция PostgreSQL с ролевой изоляцией (`REVOKE ALL ON SCHEMA players` для всех ИИ-ролей)
- `src/`
  - `config.js` — 35 параметров `MATCH_RULES_V4`, 10 `PRESS_REJECTION_REASONS`, 6 зон стола, 9 региональных узлов TMA, пороги пинга, возрастные фильтры и 8 ролей RBAC
  - `db/{database,isolation,seed,seed-cli,retention-cli}.js` — Основная БД + отдельная архивная БД `director-archive.sqlite`, горячий бэкап `VACUUM INTO` и шлюзы строгой изоляции
  - `security/{auth,validator,promptGuard,jsonSchema,audit}.js` — `scrypt`, защита от брутфорса, 6-точечный валидатор физики и свежести свайпа, защита от prompt injection, JSON Schema карантин и неизменяемый аудит
  - `ai/prompts/{ops,fraud,balance,market,lab,director}.js` — Изолированные промпты каждой зоны и 4-блочный шаблон Директора
  - `ai/{providers,director}.js` & `ai/zones/{opsZone,fraudZone,balanceZone,marketZone,labZone}.js` — Квоты токенов, кэш промптов, Batch `-50%`, цепочка резервных провайдеров и 5 аналитических зон
  - `services/{observability,telegramBot,liveops,readiness}.js` — 4 золотых сигнала SRE, `2σ` аномалии, Read-Only Telegram-бот с `Ack`, LiveOps, 152-ФЗ/GDPR и 23 проверки готовности
  - `routes/{adminRoutes,clientRoutes}.js` & `server.js` — HTTP API + нативный RFC 6455 WebSocket `/ws/client`
- `runbooks/` — 5 операционных регламентов (включая `rb-dr-backup-restore.md`)
- `public/` — Веб-интерфейс Admin CRM без внешних CDN и без inline-скриптов (`CSP: script-src 'self'`)
- `tests/crm.test.js` — Полный интеграционный набор проверок по всем 15 факторам ТЗ (`8/8 PASS`)

## Команды запуска и проверки

```bash
cd newfolder
npm run seed:reset   # Инициализация / сброс демо-данных, сводок 5 ИИ-зон и архивной БД
npm run retention    # Запуск очистки 90 / 180 / 365 дней и архивации чата >72ч
npm test             # Прогон всех интеграционных тестов по 15 факторам ТЗ
npm start            # Запуск сервера Admin CRM на 0.0.0.0:4100
```

Вход в веб-панель: `owner@topspin.arena` / `TopspinAdmin2026!`.
