# Статус реализации CRM

## Реализовано полностью в `newfolder/`

- Отдельное production-ready по структуре приложение: Node.js HTTP API + SQLite + vanilla JS SPA, без npm-зависимостей.
- 17 разделов админки: Обзор, Ops, Alerts, Balance, Market, Economy, Players, Director, AI, Proposals, Fraud, Lab, LiveOps, Tickets, Content, Integration, Settings/Audit.
- Единая validated event schema, HMAC ingestion, batch transaction, dedupe/idempotency, replay nonce, rate limits.
- Ops/Balance/Market/Economy dashboards без обязательного ИИ.
- Пять изолированных AI-зон с ключами/лимитами/каденсами, OpenAI-совместимым адаптером и local fallback.
- Director chat, 72h sliding window, persistent state, JSON Schema, quarantine.
- Fraud signals/risk/cases/evidence, ручной review и ban.
- Lab A/B/результаты/отчёты/CI test_result.
- Human-in-the-loop proposals, whitelist execution, decisions и полный audit.
- Maintenance + auto push, раздельные pushes/news, read/dismiss, support tickets, content plan.
- Telegram read-only bot, alerts/digest, Ack.
- Consents, region/data residency config, deletion/anonymization, retention.
- CSV exports, runbooks, Dockerfile/docker-compose, smoke и automated tests.

## Соответствие этапам `08-implementation-plan.md`

| Этап | Статус |
|---|---|
| 0. Подготовка | env/secrets, dev/test/prod config, tests, Docker |
| 1. Телеметрия | реализовано |
| 2. Зоны без ИИ | реализовано |
| 3. ИИ в зонах | реализовано; внешние ключи задаёт владелец |
| 4. Директор | реализовано |
| 5. Антифрод | реализовано с human review |
| 6. Lab | реализовано |

## Осознанные границы (не скрываем)

1. Текущий `source/` клиент не подключён и не менялся по требованию владельца.
2. Production-authoritative PvP, реальные Stars-платежи и Telegram initData относятся к будущему игровому backend.
3. Внешние LLM и Telegram API не вызываются в тестах; их доступность/ключи проверяются в вашей сети.
4. SQLite подходит для старта соло-фаундера. Для нескольких записывающих инстансов нужен PostgreSQL и внешний scheduler/queue.
5. Юридические документы, DPA, региональное размещение и 152-ФЗ/GDPR требуют отдельного юридического и инфраструктурного аудита; код даёт технические механизмы, но не юридическое заключение.
6. Демо-данные синтетические, не результаты реальных игроков.

## Проверка

`npm test` — 27 тестов; `npm run smoke` — end-to-end проверка API. Дополнительно выполнен реальный Chromium-прогон: login, все 17 экранов, player modal, integration preview и mobile 390×844 — без client errors и horizontal overflow. Подключение: `INTEGRATION.ru.md`.
