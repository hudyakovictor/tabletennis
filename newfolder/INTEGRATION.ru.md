# Подключение TOPSPIN ARENA CRM

Это инструкция по запуску готовой админки и подключению **будущего игрового бэкенда**. Текущий клиент в `source/` не изменялся и не считается подключённым: он остаётся демо до переписывания.

## 1. Требования и быстрый запуск

- Node.js **22.5+** (используется встроенный `node:sqlite`).
- npm-зависимости не нужны. `npm install` не требуется.
- Один процесс CRM и один SQLite-файл. Для прода — HTTPS reverse proxy и постоянный volume.

```bash
cd newfolder
cp .env.example .env
# Обязательно отредактируйте ADMIN_PASSWORD, SESSION_SECRET и INGEST_KEYS.
npm start
```

Откройте `http://localhost:4173`. По умолчанию `DEMO_DATA=1`: при первом запуске создаются вымышленные 45 дней телеметрии и CRM-объекты. Для чистой БД установите `DEMO_DATA=0`.

Если `ADMIN_PASSWORD` не задан, случайный пароль печатается **один раз в серверный лог**. Смените его в **Настройки → Безопасность и аудит**.

Проверки:

```bash
npm test        # контракты, безопасность, метрики, end-to-end API
npm run smoke   # поднимает временный сервер и проверяет основные endpoint'ы
```

## 2. Минимальная production-конфигурация

```dotenv
CRM_ENV=production
HOST=0.0.0.0
PORT=4173
CRM_DB_PATH=data/crm.sqlite
DEMO_DATA=0
ADMIN_USER=owner
ADMIN_PASSWORD=длинный-уникальный-пароль
SESSION_SECRET=случайная-строка-64-символа
COOKIE_SECURE=1
TRUST_PROXY=1
ADMIN_ORIGINS=https://crm.example.com
CLIENT_ORIGINS=https://game.example.com
FRAME_ANCESTORS='self'
INGEST_KEYS=game-prod:случайный-секрет-32+-символа
JOBS_ENABLED=1
```

- `TRUST_PROXY=1` включайте только за своим reverse proxy.
- `ADMIN_ORIGINS` и `CLIENT_ORIGINS` — explicit allowlist, без `*` в проде.
- `.env` не коммитится и не отдаётся через HTTP.
- Не размещайте CRM по пути внутри публичного игрового HTML. Используйте отдельный поддомен.

Пример запуска в Docker:

```bash
cp .env.example .env
# заполнить .env
docker compose up -d --build
```

Данные сохраняются в volume `crm-data`.

## 3. Схема подключения

```text
[Новый Mini App]
      | HTTPS/WSS, без секретов CRM
      v
[Игровой бэкенд] ── HMAC-SHA256 ──> [CRM /api/ingest/events]
      |                                  |
      |── проксирует поддержку/согласия ──>│── подписанные /api/client/*
      |                                  │
      |<── config/feed через backend ─────┤
      v                                  v
[Игроки]                         [Владелец → Admin SPA]
```

**В Mini App нельзя встраивать:** `INGEST` secret, пароль админки, session secret, AI-ключи, Telegram bot token, внутренние URL CRM. Браузер и DevTools — недоверенная среда.

## 4. Подпись ingestion

### Endpoint

`POST /api/ingest/events`, `Content-Type: application/json`.

Тело — массив событий или `{ "events": [...] }`, максимум `INGEST_MAX_BATCH` (по умолчанию 1000), тело до 5 МБ.

### Заголовки

| Заголовок | Значение |
|---|---|
| `x-tt-key` | ID ключа из `INGEST_KEYS` (не секрет) |
| `x-tt-timestamp` | Unix time в секундах; допустимый skew 300 секунд |
| `x-tt-signature` | hex HMAC-SHA256 |
| `x-tt-nonce` | UUID/случайная строка для replay-защиты, рекомендуется |

Подпись вычисляется по **точным сырым байтам тела**:

```text
hex(HMAC_SHA256(secret, `${x-tt-timestamp}.${rawBody}`))
```

### Node.js-пример для игрового бэкенда

```js
import crypto from 'node:crypto';

const CRM_URL = 'https://crm.example.com';
const KEY_ID = 'game-prod';
const SECRET = process.env.CRM_INGEST_SECRET; // только на backend

export async function sendTelemetry(events) {
  const body = JSON.stringify({ events }); // не сериализуйте повторно после подписи
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto.createHmac('sha256', SECRET)
    .update(`${timestamp}.${body}`).digest('hex');

  const response = await fetch(`${CRM_URL}/api/ingest/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tt-key': KEY_ID,
      'x-tt-timestamp': timestamp,
      'x-tt-signature': signature,
      'x-tt-nonce': crypto.randomUUID(),
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  // Повторная отправка того же пакета безопасна при сохранённых id/dedupe_key.
  return result; // { accepted, duplicates, dispatched, rejected }
}
```

### Python-пример

```python
import hashlib, hmac, json, os, time, uuid, requests

body = json.dumps({"events": events}, separators=(",", ":")).encode()
ts = str(int(time.time()))
sig = hmac.new(os.environ["CRM_INGEST_SECRET"].encode(),
               ts.encode() + b"." + body, hashlib.sha256).hexdigest()
r = requests.post("https://crm.example.com/api/ingest/events", data=body, headers={
    "Content-Type": "application/json", "x-tt-key": "game-prod",
    "x-tt-timestamp": ts, "x-tt-signature": sig, "x-tt-nonce": str(uuid.uuid4()),
}, timeout=10)
r.raise_for_status()
```

Готовый локальный пример:

```bash
CRM_URL=http://localhost:4173 \
INGEST_KEY_ID=game-local \
INGEST_SECRET='dev-secret-change-me-please-32chars' \
node tools/ingest-example.js
```

## 5. Единая схема событий

Общий envelope:

```json
{
  "id": "uuid-или-детерминированный-id",
  "type": "input",
  "ts": "2026-10-28T09:00:00.000Z",
  "region": "RU",
  "player_id": "server-player-pseudonym",
  "session_id": "server-session-id",
  "data": { "accepted": 0, "reject_code": "OUTSIDE_ZONE" }
}
```

- `id` также используется как `dedupe_key` по умолчанию. Можно передать отдельный `dedupe_key`.
- Не отправляйте email, телефон, полное имя, Telegram initData или fingerprint открытым текстом.
- `region`: `RU`, `CIS`, `EU`, `IN`, `BR`, `US`, `OTHER`.
- Неизвестные поля `data` отбрасываются; неизвестные типы и reject codes отклоняются.
- Ответ содержит `accepted`, `duplicates`, `rejected[]`. Сохраняйте неподтверждённые события и повторяйте с экспоненциальной задержкой.

| type | Основные поля `data` | Назначение |
|---|---|---|
| `install` | channel, campaign, creative, platform | атрибуция и когорты |
| `session_start` | device_type, platform, build_version, rules_version, hand, grip, ping_ms | начало сессии |
| `session_end` | duration_s, fps_avg, crash, matches, points | завершение, DAU/retention |
| `input` | pointer_type, accepted, reject_code, along, across, ball_speed, spin, timing_error_ms, distance_px, direction_dot, shot_type, rules_version, build_version, hand, grip | Balance и Ops |
| `perf` | fps, frame_ms, update_ms, render_ms, ui_ms, long_task_ms, scale, ping_ms | производительность |
| `error` | level, code, message, stack_hash, build_version | ошибки |
| `crash` | reason, build_version, device_type | крэши |
| `http_request` | route, method, status, latency_ms | золотые сигналы |
| `ping` | endpoint, ping_ms, status | региональный пинг |
| `match_end` | won, rally, hits, duration_s | агрегаты матча |
| `payment` | amount_usd, currency, product_id, product_kind, status, provider, idempotency_key, refunded, chargeback | выручка/LTV |
| `economy` | kind=source/sink, currency, amount, item_id, balance_after | экономика |
| `marketing` | channel, campaign, creative, cost_usd, installs, impressions, clicks, type | CAC/CPI/ROAS |
| `test_result` | kind, source, payload | Lab/CI |
| `consent` | telemetry, ai_analysis, marketing | явные opt-in |
| `deletion_request` | source | запрос удаления |
| `support_ticket` | subject, message, screenshot_url, build_version | поддержка |

Допустимые `reject_code`: `OUTSIDE_ZONE`, `NO_FRESH_SWIPE`, `STATIC_CLICK`, `DEPTH_FAIL`, `TIMING_LATE`, `TIMING_EARLY`, `CONSUMED`, `SERVE_TOSS_LOW`, `WRONG_DIRECTION`, `BOUNCE_ILLEGAL`.

### Карта полей из текущего движка для будущего backend

| Поле движка (`43_input_telemetry.js`) | Поле CRM |
|---|---|
| `accepted` | `accepted` (0/1) |
| `reason` | `reject_code` |
| `along`, `across` | `along`, `across` |
| `distancePx` | `distance_px` |
| `directionDot` | `direction_dot` |
| `timingErrorMs` | `timing_error_ms` |
| `rulesVersion` | `rules_version` |
| `build` | `build_version` |
| `wallMs` | преобразовать в ISO `ts` |

`45_perf.js`: `fps`, `avg` → `frame_ms`, `sec.update/render/ui` → соответствующие `*_ms`, `scale` → `scale`.

Скриншоты `44_miss_shots.js` и подробные диагностические отчёты не выгружайте автоматически. Это чувствительные данные; для поддержки используйте только явное действие пользователя и отдельную политику хранения.

### Рекомендуемый batching

- Ввод и perf: агрегировать/отправлять пакетами каждые 15–30 секунд или по 200–500 событий.
- Критичные `payment`, `crash`, `deletion_request`: отправлять сразу с retry.
- Не отправлять каждый кадр или каждый pointermove.
- При 429/5xx: exponential backoff + jitter, без изменения `dedupe_key`.

## 6. Клиентские API

### Публичные, без ПДн

```http
GET /api/client/config
GET /api/client/feed?region=RU&platform=android
```

`config` возвращает:

- `maintenance.enabled`, `maintenance.text`, `maintenance.eta`, `block_matchmaking`;
- `feature_flags`;
- `match_rules`, `rules_version`, `active_build`;
- `paused_campaigns`;
- `region_endpoints`, `ping_warn_ms`.

Новый клиент проверяет config при старте и перед matchmaking. Maintenance блокирует только вход в матч, не меню/профиль/новости.

`feed` возвращает два отдельных массива:

```json
{
  "pushes": [{ "id": "…", "important": true, "pinned": true, "read_at": null }],
  "news": [{ "id": "…", "category": "patch_notes", "published_at": "…" }],
  "maintenance": { "enabled": false }
}
```

Пуши всегда сверху приоритетной ленты и визуально отличаются. В обычную новостную ленту их не добавляйте. После dismiss пуш остаётся в истории.

### Подписанные backend→CRM

Эти запросы требуют те же HMAC-заголовки, что ingestion. Mini App вызывает **свой игровой backend**, а он подписывает запрос к CRM:

| Метод | Назначение |
|---|---|
| `POST /api/client/tickets` | создать тикет |
| `GET /api/client/tickets?player_id=…` | тикеты игрока |
| `GET /api/client/tickets/:id?player_id=…` | тикет и видимые ответы |
| `POST /api/client/consents` | сохранить opt-in |
| `POST /api/client/deletion` | запросить удаление ПДн |
| `POST /api/client/pushes/:id/read` | прочитать/dismiss пуш |

Для GET подпись считается по пустому raw body: `${timestamp}.`.

Пример создания тикета через backend:

```json
{
  "player_id": "server-player-pseudonym",
  "region": "RU",
  "subject": "Не засчитывает удар",
  "body": "Описание проблемы",
  "build_version": "3.0.0",
  "priority": "normal"
}
```

## 7. Подключение AI-провайдеров

CRM полностью работает без AI-ключей: используется явно обозначенный `local-heuristic` анализ тех же метрик.

Для внешней модели задайте ключи **отдельно для каждой зоны**:

```dotenv
AI_OPS_BASE_URL=https://openrouter.ai/api/v1
AI_OPS_API_KEY=...
AI_OPS_MODEL=openai/gpt-4o-mini
AI_OPS_DAILY_TOKENS=100000
AI_OPS_PRICE_IN=0.15
AI_OPS_PRICE_OUT=0.60
```

Аналогично `AI_FRAUD_*`, `AI_BALANCE_*`, `AI_MARKET_*`, `AI_LAB_*`, `AI_DIRECTOR_*`.

- Endpoint адаптера: `POST {BASE_URL}/chat/completions`, OpenAI-совместимый формат.
- Для локального vLLM/Ollama укажите свой OpenAI-совместимый base URL.
- `AI_LOCAL_FALLBACK=1`: после ошибки провайдера используется локальный анализ.
- Ответ всегда проверяется JSON Schema. Невалидный ответ — в карантин.
- Не передавайте ПДн: текущие dataset'ы содержат только агрегаты/ID кейсов.
- Ключи нельзя менять через браузер: только `.env` + restart.

## 8. Telegram-бот

1. Создайте отдельного бота через BotFather и получите token.
2. Узнайте chat ID владельца/чата алертов.
3. Настройте:

```dotenv
BOT_ENABLED=1
BOT_TOKEN=...
BOT_CHAT_IDS=123456789,-1001234567890
BOT_DAILY_DIGEST_HOUR=9
CRM_TIMEZONE=Europe/Moscow
```

4. Перезапустите CRM. Бот использует long polling `getUpdates`; публичный webhook не нужен.

Команды: `/status`, `/ping`, `/errors`, `/players`, `/revenue`, `/ai`, `/fraud`, `/alerts`, `/ack ID`, `/help`.

Бот не имеет команд смены правил, банов, платежей или настроек. Неизвестные chat ID игнорируются. Для работы нужен исходящий доступ сервера к `api.telegram.org`.

## 9. LiveOps и подключение нового клиента

1. Создайте новость (`patch_notes`, `known_issues`, `event`, `announcement`) и опубликуйте.
2. Ручной пуш используйте только для критичных сообщений.
3. Включение/выключение maintenance автоматически создаёт пуш.
4. Клиентская приоритетная лента вызывает `push_reads` через backend.
5. Поддержка: форма Mini App → ваш backend → подписанный `/api/client/tickets`; статусы и ответы забираются тем же каналом.
6. Всплеск тикетов автоматически учитывается Ops-детектором.

## 10. Backup, retention и эксплуатация

- Держите `data/` на постоянном диске; SQLite работает в WAL.
- Для консистентного backup остановите CRM или используйте SQLite online backup; не копируйте только WAL отдельно.
- Проверяйте восстановление backup, а не только его наличие.
- Retention запускается ежедневно: input 90 дней, telemetry/AI 180, chat 365.
- Удаление игрока: **Игроки → профиль → Удалить/анонимизировать ПДн**.
- CSV export доступен для игроков, платежей, алертов, тикетов, fraud, AI и аудита.
- Логи сервера не должны содержать `.env`, тела событий с ПДн или AI-ключи.

## 11. Troubleshooting

| Проблема | Проверка |
|---|---|
| 401 на ingestion | key ID, секрет, timestamp в секундах, подпись именно raw body |
| 409 nonce replay | генерируйте новый nonce для нового запроса; при retry используйте осознанно тот же пакет и новый nonce |
| 400 unknown reject_code | сверить с `MATCH_RULES` и `/api/ingest/schema` |
| 401 в админке | истекла сессия; войти заново |
| 403 CSRF | SPA должна использовать `X-CSRF-Token` из `/api/auth/me` |
| CORS | добавить точный origin в `ADMIN_ORIGINS`/`CLIENT_ORIGINS` |
| Iframe не открывается | `FRAME_ANCESTORS=*` для preview; в проде указать нужный origin |
| AI всегда local | проверить `AI_<ZONE>_API_KEY`, base URL, дневной лимит и карантин |
| Бот молчит | `BOT_ENABLED=1`, token, chat ID whitelist, исходящая сеть |
| Нет данных | проверить `DEMO_DATA`, ingestion response, период дашборда и часовой пояс timestamps |

## 12. Что остаётся на этап переписывания клиента

- Авторитетная игровая логика и платёжный backend.
- Проверка Telegram `initData` на игровом backend и выдача серверного player pseudonym.
- Постоянная очередь telemetry с retry и идемпотентными ID.
- Подписка клиента на config/feed и экран поддержки.
- Реальные WebSocket-зонды/региональный роутинг и production PvP.
- Проверка внешних AI/Telegram-провайдеров из вашей сети и юридический review документов/регионов.
