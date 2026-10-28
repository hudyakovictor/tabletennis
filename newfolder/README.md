# TOPSPIN ARENA — Admin CRM

Готовая серверная CRM и админ-панель для TOPSPIN ARENA. Код приложения находится в этом каталоге; текущий демо-клиент в `source/` не изменялся.

## Быстрый старт

Требуется Node.js 22.5+. Внешних npm-зависимостей нет.

```bash
cd newfolder
cp .env.example .env
# задайте ADMIN_PASSWORD, SESSION_SECRET и INGEST_KEYS
npm start
```

- Админка: `http://localhost:4173`
- `DEMO_DATA=1` — детерминированные вымышленные данные при первом запуске.
- `DEMO_DATA=0` — чистая production БД.
- Если пароль не задан, начальный пароль печатается в серверный лог один раз.

```bash
npm test        # 27 автоматических тестов
npm run smoke   # end-to-end smoke на временном сервере
npm run seed    # заполнить пустую БД демо-данными
```

**Подключение игры и production:** [INTEGRATION.ru.md](INTEGRATION.ru.md)
**API:** [API.md](API.md) · **Руководство:** [ADMIN-GUIDE.ru.md](ADMIN-GUIDE.ru.md)
**50 анализов:** [ANALYSIS-50.md](ANALYSIS-50.md) · **Статус:** [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md)

## Что реализовано

- Обзор с DAU, сессиями, выручкой, FPS, отказами ввода, алертами.
- Ops: latency/traffic/errors/saturation, крэши, сборки, устройства, ping регионов.
- Balance: along/across heatmap, reject codes, rules/build/device/hand-сегменты.
- Market: каналы/кампании/креативы, CPI/CAC/LTV/ROAS/eCPM, когорты D1/D7/D30.
- Экономика: платежи, продукты, регионы, sink/source валюты.
- Игроки: сессии, платежи, согласия, риск, ручной ban, удаление/анонимизация ПДн.
- Пять изолированных AI-зон + Director chat, лимиты, стоимость, JSON validation, карантин.
- Fraud risk scoring и ручная очередь кейсов.
- Lab: гипотезы, A/B-варианты, замеры, отчёты и CI test results.
- Human-in-the-loop: предложения, approve/execute, decisions, audit.
- Maintenance, автоматические пуши, новости, поддержка, контент-план.
- Telegram-бот для чтения/алертов/ежедневной сводки.
- HMAC ingestion, идемпотентные батчи, подписанные приватные client API.
- CSP/CORS/CSRF/scrypt/rate limits/retention/CSV/Docker/runbooks.

## Главный принцип

ИИ не создаёт уровни, туториалы и игровые режимы и не управляет игрой. Он анализирует уже собранные данные и предлагает выводы. **Финальное решение и каждое значимое действие — только за владельцем.**

CRM работает без AI-ключей: локальный `local-heuristic` анализирует те же агрегаты и явно обозначается как детерминированный, а не как LLM.

## Структура приложения

```text
newfolder/
  server/
    index.js           запуск и lifecycle
    router.js          HTTP API + static SPA
    config.js          env и публичный конфиг без секретов
    db.js              SQLite schema, транзакции, аудит
    events.js          единый контракт событий
    ingest.js          транзакционный ingestion
    auth.js            scrypt/session/CSRF/HMAC/rate limits
    security.js        CORS/CSP/body limits
    metrics.js         агрегаты дашбордов
    fraud.js           сигналы и ручной review
    liveops.js         maintenance/news/pushes/tickets/content
    actions.js         proposals/decisions/retention
    alerts.js          детекторы
    bot.js             Telegram read-only bot
    jobs.js            scheduler
    ai/                providers, schemas, zones, director
    tests/             автоматические тесты
  public/              admin SPA (без фреймворков и CDN)
  tools/               seed/smoke/signed ingestion example
  runbooks/            эксплуатационные инструкции
  .env.example         вся конфигурация
  Dockerfile
  docker-compose.yml
```

## Исходные документы ТЗ

1. `01-architecture.md` — общая архитектура и зоны.
2. `02-ai-zones.md` — зоны ИИ, задачи, модели, лимиты.
3. `03-director-chat.md` — чат с директором и память.
4. `04-security.md` — безопасность, DevTools, prompt injection.
5. `05-legal-rf-sanctions.md` — 152-ФЗ, санкции, география данных.
6. `06-data-schema.md` — схема БД и региональное разделение.
7. `07-ai-providers.md` — провайдеры ИИ, fallback, лимиты.
8. `08-implementation-plan.md` — этапы и приоритеты.
9. `09-api-contracts.md` — контракты между зонами и директором.
10. `10-checklist.md` — чек-лист перед запуском.
11. `13-telegram-miniapp-latency.md` — пинг в Telegram Mini Apps.
12. `14-observability-runbooks.md` — мониторинг, алерты, runbooks.
13. `15-liveops-content-plan.md` — LiveOps, контент-план, сообщество.
14. `16-legal-player-agreements.md` — ToS, Privacy Policy, согласия.
15. `17-maintenance-push-news-support.md` — техработы, пуши, новости, поддержка.

В ТЗ упоминались отсутствующие `11-latency-netcode.md` и `12-regional-servers.md`; соответствующие требования также присутствуют в документе 13 и учтены в `REGION_ENDPOINTS`/Ops. Существующий PvP relay в `source/` не выдаётся за завершённый production-неткод.
