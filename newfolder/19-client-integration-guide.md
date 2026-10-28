# Подключение игрового клиента к TOPSPIN ARENA CRM (`v3.0`)

Документ — единственный источник истины по стыку «клиент ↔ сервер» для будущего рерайта клиента (Telegram Mini App / WebGL / Mobile Web).
Он описывает **то, что реально реализовано** в `newfolder/src/routes/clientRoutes.js` и `newfolder/src/server.js` (проверено `tests/platform.test.js`), а не планируемое поведение.

> **Инвариант (`01-architecture.md`).** Клиент общается только с `/api/client/v1/*` и `/ws/client`. Запросы к `/api/admin/*` с игрового origin отклоняются (`403 FORBIDDEN_ADMIN_ORIGIN`). Клиент никогда не получает API-ключи провайдеров, промпты, сводки ИИ-зон и не упоминает ИИ в интерфейсе — вся аналитика живёт на сервере.

**Версия контракта:** 3.0 · **Дата:** 2026-10-28 · **Совместимость:** ломающих изменений относительно 2.0 нет, добавлены уведомления, WS-тикет, дедупликация телеметрии и вложенный блок `maintenance`.

---

## 1. Базовая модель

| Свойство | Значение |
|---|---|
| База | `https://<регион>.game.topspin.arena` (локально `http://0.0.0.0:4100`) |
| Формат | `application/json; charset=utf-8`, UTF-8, camelCase в ответах |
| Аутентификация | `Authorization: Bearer <playerToken>` (JWT 7 дней, роль `player`) |
| Идемпотентность | `Idempotency-Key: <uuid>` на любом `POST`, который меняет состояние |
| Язык ошибок | машинный `error` + человекочитаемый `message` на русском |
| Регион | определяется по IP/заголовкам; при `CN` без ICP-лицензии — `451` |
| Ретраи | `GET` — с экспоненциальной задержкой; `POST` — только с тем же `Idempotency-Key` |

Клиент **не** хранит серверные секреты, **не** вычисляет авторитетных результатов матча и **не** отправляет собственные «очки» — только телеметрию свайпов с `clientEventId`.

---

## 2. Жизненный цикл сессии

```text
[1] GET  /api/client/v1/bootstrap          правила, A/B, техработы, пуши, новости, возрастной гейт
[2] POST /api/client/v1/auth/telegram      initData → playerToken + playerId
[3] POST /api/client/v1/legal/consent      возраст и opt-in (при первом входе и смене версии документа)
[4] POST /api/client/v1/session/start      старт матча или реконнект по affinityToken
[5] POST /api/client/v1/ws/ticket          одноразовый тикет на 60 с
[6] WS   /ws/client?ticket=<ticket>        realtime: welcome, keep-alive 25 с, RTT
[7] POST /api/client/v1/telemetry/inputs   пакеты свайпов каждые 3–5 с (дедупликация по clientEventId)
[8] POST /api/client/v1/telemetry/session-end   FPS p5, RTT p50/p95, crash, WebGL loss
```

Порядок 1→4 обязателен. Шаг 5 можно выполнять параллельно с 4, но **не раньше** получения `sessionId`.

---

## 3. REST-эндпоинты

### 3.1 `GET /api/client/v1/ping`
Дешёвый health-check и измерение RTT до узла.

```json
{ "pong": true, "clientSentTs": 0, "serverTs": 1793187723446, "region": "RU", "nodeId": "ru-msk-tma-01", "warnThresholdMs": 100 }
```

### 3.2 `GET /api/client/v1/bootstrap`
Вызывается до входа в матч. Не требует токена (если он есть — учитывается для A/B).

```json
{
  "serverTimeUtc": "2026-10-28T11:42:03.433Z",
  "region": "RU",
  "recommendedEndpoint": {
    "nodeId": "ru-msk-tma-01", "code": "ru-msk-1", "label": "РФ + СНГ (Москва / Питер)",
    "wsUrl": "wss://msk.game.topspin.arena/ws/client", "active": true,
    "rollout": "immediate", "targetRttMs": 38
  },
  "wsEndpoint": "/ws/client",
  "pingThresholds": {
    "excellentMaxMs": 35, "goodMaxMs": 65, "playableRollbackMaxMs": 100,
    "warnClientThresholdMs": 100, "poorWarnMaxMs": 150,
    "excellentMs": 35, "goodMs": 65, "warnMs": 100, "unacceptablePvpMs": 150
  },
  "ageGate": { "minAgeWithoutParentalConsent": 14, "law": "152-ФЗ / ГК РФ" },
  "maintenance": {
    "enabled": false, "bannerRu": "", "bannerEn": "", "etaIso": null,
    "allowActiveMatchesFinishGraceSec": 180, "blockNewMatchesHttp503": false,
    "updatedAt": "2026-10-26T11:33:18.542Z"
  },
  "matchRules": { "version": 4, "zoneShape": "oval", "pressRadiusPx": 96, "...": "35 полей MATCH_RULES v4" },
  "abVariant": "control",
  "notifications": [ { "id": "…", "priority": "important", "pinned": 1, "title_ru": "…" } ],
  "news": [ { "id": "…", "category": "update", "title_ru": "…", "published": 1 } ],
  "legalDocuments": [ { "docType": "tos", "version": "1.4", "lang": "ru", "title": "Условия использования" } ]
}
```

* `matchRules` — **эффективные** правила: базовый профиль + патч A/B-варианта. Клиент обязан применить их целиком и отправлять `rulesVersion` в телеметрии.
* `maintenance.enabled = true` означает: новые матчи блокируются, но активная партия доигрывается (`allowActiveMatchesFinishGraceSec`).
* Регион `CN` без `CN_ICP_LICENSED=1` → `451 Unavailable For Legal Reasons`.

### 3.3 `POST /api/client/v1/auth/telegram`
```json
{ "initData": "query_id=…&user=%7B…%7D&auth_date=…&hash=…", "installSource": "telegram_ads", "installCampaign": "autumn_cup", "installCreative": "cr_video_1" }
```
Сервер проверяет HMAC-SHA256 `initData` (включая `auth_date`), создаёт игрока при первом входе, возвращает:

```json
{ "ok": true, "playerId": "plr_0091", "displayName": "Player_1091", "region": "RU",
  "recommendedEndpoint": { "nodeId": "ru-msk-tma-01", "wsUrl": "wss://…" }, "playerToken": "eyJhbGciOi…" }
```
Ошибки: `401 INVALID_TELEGRAM_INIT_DATA`, `403 ACCOUNT_BANNED` (`reason`), `429 RATE_LIMITED` (30 попыток/мин на IP).

### 3.4 `POST /api/client/v1/legal/consent`
Обязателен до первого матча и при смене `docVersion`.

```json
{ "docType": "tos", "docVersion": "1.4", "declaredAge": 14,
  "parentalConsent": false, "analyticsOptIn": true, "marketingOptIn": false }
```
Ответ `200`:
```json
{ "ok": true, "id": "9eb5f09f-…", "consentedAt": "2026-10-28T11:42:05.872Z",
  "ageGate": { "valid": true, "isMinor": false, "requiresParentalConsent": false, "minAge": 14, "law": "152-ФЗ / ГК РФ" } }
```
`403` с `ageGate.requiresParentalConsent = true` — клиент обязан запросить подтверждение опекуна и повторить с `parentalConsent: true`. Возрастные пороги: `US 13`, `EU 16`, `RU 14`, иначе `13`.

### 3.5 `POST /api/client/v1/session/start`
Новый матч:
```json
{ "platform": "tma_android", "deviceFingerprint": "stable-per-install-hash", "region": "RU" }
```
Реконнект (после переключения сети или сворачивания TMA):
```json
{ "affinityToken": "<токен из предыдущего ответа>", "platform": "tma_android" }
```
Успех `201`:
```json
{ "ok": true, "reconnected": false, "sessionId": "ses_df30257999de7fa8", "region": "RU",
  "nodeId": "ru-msk-tma-01", "wsEndpoint": "/ws/client", "affinityToken": "eyJhbGciOi…" }
```
Реконнект возвращает `200` с `reconnected: true` и тем же `sessionId`; **новый** `affinityToken` не выдаётся — используйте прежний.

Коды: `401 PLAYER_AUTH_REQUIRED`, `403 PLAYER_RESTRICTED` (`status: banned|suspended`), `404 PLAYER_NOT_FOUND`, `429 SESSION_START_RATE_LIMITED` (20/мин на игрока).

**Техработы (`503`)** — единственный случай, когда новый матч запрещён:
```json
{ "error": "MAINTENANCE_ACTIVE", "matchmakingBlocked": true, "retryAfterSec": 60,
  "bannerRu": "Обновляем серверы — вернёмся через 15 минут", "bannerEn": "Updating servers — back in 15 minutes", "etaIso": "2026-10-28T12:05:00.000Z",
  "maintenance": { "enabled": true, "bannerRu": "…", "bannerEn": "…", "etaIso": "…",
                   "retryAfterSec": 60, "allowActiveMatchesFinishGraceSec": 180 } }
```
Заголовок `Retry-After: 60`. Клиент показывает баннер и **не** ретраит чаще, чем указано.

### 3.6 `POST /api/client/v1/ws/ticket`
Долгоживущий `playerToken` в URL WebSocket попадать не должен — прокси и CDN логируют query string. Тикет живёт 60 секунд и одноразовый.

```json
{ "sessionId": "ses_df30257999de7fa8", "affinityToken": "eyJhbGciOi…" }
```
```json
{ "ok": true, "ticket": "9kQ…", "expiresAt": "2026-10-28T11:44:05.000Z",
  "wsEndpoint": "/ws/client?ticket=9kQ…", "nodeId": "ru-msk-tma-01", "keepAliveSec": 25 }
```

### 3.7 `POST /api/client/v1/telemetry/inputs`
Пакет свайпов каждые 3–5 секунд. Лимит `120` пакетов/мин на IP; превышение — `429 TELEMETRY_RATE_LIMITED` + `Retry-After`.

```json
{
  "sessionId": "ses_df30257999de7fa8",
  "events": [{
    "clientEventId": "evt_01J8…", "ts": "2026-10-28T11:43:02.120Z",
    "pointerType": "touch", "grip": "shakehand", "hand": "right", "isServe": false,
    "tableZone": "deep_bh", "hasFreshSwipe": true, "swipeStraightness": 0.91,
    "along": 0.62, "across": -0.34, "accepted": false, "contact": false,
    "rejectCode": "OUTSIDE_ZONE", "strokeType": "backhand",
    "ballSpeed": 16.4, "spin": 152, "reactionMs": 268, "sweetSpotDist": 0.21,
    "rulesVersion": 4, "abVariant": "control"
  }]
}
```

**Поля события.** Принимаются и `camelCase`, и `snake_case` (`clientEventId` = `client_event_id`, `tableZone` = `table_zone`, `rejectCode` = `reject_code`, `ballSpeed`, `reactionMs`, `isServe`, `hasFreshSwipe`, `swipeStraightness`, `strokeType`, `sweetSpotDist`, `rulesVersion`, `abVariant`, `isGrace`, `eventId`). camelCase предпочтителен для JS-клиента.

| Поле | Тип | Обязательно | Комментарий |
|---|---|---|---|
| `clientEventId` | string `[A-Za-z0-9_.:-]{1,64}` | да, для exactly-once | ключ дедупликации в рамках `sessionId` |
| `ts` | ISO-8601 | да | серверное время не подменяется, но `ts` валидируется |
| `along`, `across` | number | да | нормализованные координаты контакта (−1…1) |
| `accepted` | bool | да | решение клиента; сервер проверит независимо |
| `contact` | bool | да | `true` только при `accepted` |
| `hasFreshSwipe` | bool | да | без свежего свайпа `accepted=true` — нарушение |
| `rejectCode` | string | при `accepted=false` | один из 10 кодов `MATCH_RULES v4` |
| `reactionMs` | number | желательно | участвует в детекторах фрода |
| `ballSpeed`, `spin` | number | желательно | проверяются на согласованность с позицией |
| `rulesVersion`, `abVariant` | number/string | да | какие правила реально применялись |

Ответ:
```json
{ "ok": true, "acceptedCount": 18, "dedupedCount": 0, "rejectedCount": 1, "serverTs": 1793187730123 }
```
* `acceptedCount` — сколько строк реально вставлено; `dedupedCount` — сколько отброшено как повтор (повторная отправка того же `clientEventId` даёт `acceptedCount: 0, dedupedCount: N`).
* `422 INVALID_TELEMETRY_BATCH` + `reasons[]` — все события отклонены валидатором физики.
* Пакет с нарушениями инвариантов создаёт фрод-кейс `packet_tamper_attempt` (`risk_score 0.86`) для **человеческого** разбора; автобана нет.

Правила, которые сервер проверяет сам (клиент обязан им следовать, чтобы не попасть в отклонённые): `contact` без `accepted`, `accepted` без свежего свайпа, код отказа при `accepted=true`, неизвестный код отказа, контакт вне позиции ракетки при скорости мяча > 1, координаты вне допустимых диапазонов.

### 3.8 `POST /api/client/v1/telemetry/session-end`
```json
{ "sessionId": "ses_…", "rttP50Ms": 48, "rttP95Ms": 79, "avgFps": 58.7, "p5Fps": 39, "crashed": false, "webglLost": false }
```
Эти значения питают зону Ops (FPS, RTT-коридоры, краш-рейт) и дашборд «здоровье клиента».

### 3.9 Поддержка

`POST /api/client/v1/support/tickets`
```json
{ "sessionId": "ses_…", "category": "bug", "priority": "high",
  "subject": "Не срабатывает удар с бэкхенда", "message": "На дальнем левом углу…",
  "screenshotName": "deep_bh.png", "screenshotDataUrl": "data:image/png;base64,…",
  "clientContext": { "platform": "tma_android", "rttMs": 74, "grip": "shakehand", "hand": "right", "rulesVersion": 4 } }
```
`201` → `{ ok: true, ticket: { id, status: "open", priority, sla_due_at, linked_incident_id } }`. Скриншот ≤ 40 000 символов data-URL; при совпадении контекста с активным инцидентом тикет линкуется автоматически.

`GET /api/client/v1/support/tickets` — список тикетов игрока.
`GET /api/client/v1/support/tickets/:id` — тред:
```json
{ "id": "…", "subject": "…", "status": "answered", "priority": "high", "category": "bug",
  "createdAt": "…", "updatedAt": "…", "slaDueAt": "…",
  "messages": [ { "role": "player|admin", "body": "…", "attachmentName": "deep_bh.png", "createdAt": "…" } ],
  "statusHistory": [ { "to": "answered", "at": "…", "note": "…" } ] }
```
Чужой тикет → `404` (не `403`, чтобы не подтверждать существование объекта).

### 3.10 Уведомления и новости

`GET /api/client/v1/notifications` — **единая лента**: пуши администратора всегда первыми (`pinned`, `important`), затем новости.
```json
{ "items": [
    { "id": "…", "kind": "push", "priority": "critical", "pinned": true, "important": true,
      "title": "…", "titleEn": "…", "body": "…", "bodyEn": "…", "createdAt": "…", "expiresAt": "…", "dismissible": true },
    { "id": "…", "kind": "news", "priority": "normal", "pinned": false, "important": false,
      "category": "update", "title": "…", "body": "…", "createdAt": "…", "dismissible": false } ],
  "pinnedCount": 1, "unreadCount": 1, "serverTimeUtc": "…" }
```
`POST /api/client/v1/notifications/:id/dismiss` → `{ ok: true }`; закрытый пуш больше не возвращается (таблица `notification_dismissals`). Новости не закрываются.

`GET /api/client/v1/news?category=update&limit=20` — архив патчноутов.

### 3.11 Право на данные (DSAR)

`POST /api/client/v1/privacy/request`
```json
{ "requestType": "export", "reason": "хочу свои данные" }
```
`requestType` строго `export` или `erasure`. Если клиент прислал `playerToken`, игрок берётся из токена; `playerId` в теле допустим только для ещё не аутентифицированного запроса и игнорируется при наличии токена.

`201`:
```json
{ "ok": true, "requestId": "…", "type": "export", "status": "pending",
  "requestedAt": "…", "dueAt": "…", "slaDays": 30, "message": "…" }
```
`message` — готовая фраза для игрока; клиент показывает её как есть и не придумывает сроков сам. `dueAt` — 30 календарных дней с момента приёма.

Поведение, на которое клиент может рассчитывать:

| Ситуация | Ответ |
|---|---|
| запрос принят | `201` |
| такой же запрос уже в очереди | `409 REQUEST_ALREADY_OPEN` + `requestId` существующего — **не** создавать второй, показать «уже обрабатывается» |
| игрок не найден / удалён | `404 PLAYER_NOT_FOUND` |
| неизвестный `requestType` | `400 REQUEST_TYPE_INVALID` |
| > 5 запросов в минуту с одного клиента | `429 RATE_LIMITED` + `retryAfterSec` |

Запрос не удаляет и не выгружает данные сразу: он попадает в очередь CRM, человек исполняет его, срок (30 дней) отслеживается сервером, просрочка эскалируется оператору. Ответ эндпоинта **никогда** не содержит внутренних идентификаторов игрока, зон или ИИ.

Сам пакет данных при экспорте игрок получает не через этот эндпоинт, а по регламенту поддержки (пакет данных формируется оператором); клиент не должен обещать «скачивание сейчас».

### 3.12 Прогресс, матчи, лидерборд и конфиг

Добавлено в `v3.1` для действующего клиента (сборка `play/index.html`). Клиент продолжает считать игру локально и хранит сейв `ttu-v2`; сервер получает **факты** и ведёт те числа, которые может проверить сам.

**Правило доверия.** Клиент присылает `level`, `durationMs`, счёт и `matchId` — но не рейтинг, не валюту и не «я выиграл». Рейтинг считается на сервере по Эло (`K=32`, потолок ±64), награда за уровень начисляется по числу реально пройденных ступенек (`150` монет и `20` гемов за ступень). Неправдоподобный счёт отклоняется, подозрительный матч помечается флагами (§3.13). Покадровый реплей-контроль — следующий этап.

#### `GET /api/client/v1/me`
Требует `Authorization: Bearer <playerToken>`.
```json
{ "ok": true,
  "player": { "playerId": "plr_0091", "displayName": "Player_1091", "region": "RU", "status": "active", "createdAt": "…" },
  "progress": { "level": 2, "xp": 400, "rating": 1018, "matches": 3, "wins": 2, "losses": 1,
                "streak": 1, "bestRally": 12, "coins": 300, "gems": 40, "updatedAt": "…" },
  "rewards": { "coinsPerLevel": 150, "gemsPerLevel": 20 },
  "serverTimeUtc": "…" }
```
Коды: `401 PLAYER_AUTH_REQUIRED`, `403 ACCOUNT_BANNED` (`reason`), `403 PLAYER_RESTRICTED` (`status`), `404 PLAYER_NOT_FOUND`. Прогресс создаётся лениво: первый вход даёт `level=1, rating=1000, coins=0`.

#### `POST /api/client/v1/progress/level-complete`
```json
{ "level": 2, "durationMs": 60000, "xp": 400 }
```
Проверки: `1 ≤ level ≤ 99`; `level` не меньше текущего; прыжок не больше `5` ступенек за запрос (оффлайн-очередь); `durationMs ≥ 15000 + 1500 × level`. Награда — в ответе, а не в запросе.
```json
{ "ok": true, "progress": { "level": 2, "coins": 150, "gems": 20, "…": "…" },
  "rewards": { "coins": 150, "gems": 20 }, "serverTimeUtc": "…" }
```
Отказ `422 IMPLAUSIBLE_RESULT` с `reasons` (`LEVEL_TOO_FAST`, `LEVEL_REGRESSION`, `LEVEL_JUMP`, `LEVEL_OUT_OF_RANGE`, `XP_OUT_OF_RANGE`) и `minDurationMs`. `429 RATE_LIMITED` — 30 запросов/мин на игрока.

#### `POST /api/client/v1/matches`
```json
{ "matchId": "mt_01J8…", "mode": "career", "playerScore": 11, "opponentScore": 8,
  "durationMs": 150000, "opponentRating": 1050, "opponentName": "Kai",
  "bestRally": 12, "rulesVersion": 4, "clientVersion": "shell abc123" }
```
`matchId` клиент генерирует сам — повтор с тем же id не начисляет второй раз (`replay: true`), чужой id → `409 MATCH_ID_CONFLICT`. Проверки: счёт `0…99`, счёт должен быть таким, какой возможен в настольном теннисе, `25000 ≤ durationMs ≤ 3 ч`.
```json
{ "ok": true, "replay": false, "matchId": "mt_01J8…",
  "result": { "win": true, "ratingBefore": 1000, "ratingDelta": 18, "rating": 1018 },
  "trust": { "suspicious": false, "flags": [] },
  "progress": { "…": "…" }, "serverTimeUtc": "…" }
```
Отказ `422 IMPLAUSIBLE_RESULT` (`SCORE_INVALID`, `INCOMPLETE_SCORE`, `SCORE_MARGIN`, `DURATION_INVALID`). `429 RATE_LIMITED` — 40 запросов/мин.

#### `GET /api/client/v1/leaderboard?limit=20`
Без токена — топ; с токеном добавляется `me` со своим местом.
```json
{ "ok": true, "scope": "global",
  "entries": [ { "rank": 1, "playerId": "plr_0007", "name": "Player_1007", "rating": 1310, "level": 9, "wins": 24, "losses": 6 } ],
  "me": { "rank": 41, "level": 2, "rating": 1018, "wins": 2, "losses": 1, "…": "…" },
  "serverTimeUtc": "…" }
```
`limit` ограничен `1…50`. В выдачу попадают только `status = active`.

#### `GET /api/client/v1/config`
Действующие правила боя и экономика — чтобы менять баланс без деплоя клиента.
```json
{ "ok": true, "contractVersion": 1,
  "matchRules": { "version": 4, "captureRadius": 0.34, "…": "35 полей" },
  "rewards": { "coinsPerLevel": 150, "gemsPerLevel": 20 },
  "limits": { "maxLevel": 99, "maxLevelJump": 5, "minMatchMs": 25000 },
  "maintenance": { "enabled": false, "…": "…" }, "serverTimeUtc": "…" }
```

#### Как это использует действующий клиент
`source/src/services/api.js` — единственная точка запросов (таймаут 8 с, `Idempotency-Key`, bearer из `ttu-auth`); `source/src/services/progress.js` — очередь фактов в `localStorage` (`ttu-sync`, до 40 записей) и слияние серверных чисел «только вверх», чтобы офлайн-прогресс не откатывался. Адрес API вшивается при сборке (`TT_API_BASE`), потому что бандл статический; `?api=` перекрывает его для локальной отладки. Без `TT_API_BASE` клиент работает полностью локально — это штатный режим.

### 3.13 Античит второй ступени: проверка счёта и флаги доверия

Покадрового реплея (сервер пересчитывает физику партии) ещё нет — он требует симуляции на сервере. Вторая ступень — правила, которые видно по фактам и которые не ломают игру честному игроку.

**Что отклоняется** (`422 IMPLAUSIBLE_RESULT`, `reasons`):
- `INCOMPLETE_SCORE` — никто не набрал 11 (`5:3`, `9:9`);
- `SCORE_MARGIN` — при 11+ разрыв меньше двух (`11:11`, `12:11`) или в партии после 11 — больше двух (`20:3`).

Легальный счёт после равенства (`12:10`, `13:11`) проходит без флагов. `NO_WINNER` больше не отдаётся: ничья и «нет победителя» — частные случаи двух правил выше, поэтому клиенту достаточно смотреть на `reasons`.

**Что принимается, но помечается.** Матч сохраняется, рейтинг начисляется, но запись получает `suspicious = 1`, список `flags` и уведомление Ops в CRM:
- `FAST_FINISH` — средняя длительность очка ниже `2.5` с (`durationMs < очки × 2500`): партия до 11 за `12` с не разыгрывается;
- `REPEATED_RESULT` — тот же счёт и та же длительность (±`1` с), что у предыдущего матча игрока: признак заготовленного ответа;
- `RAPID_CLIMB` — сумма положительных `rating_delta` за час ≥ `256` (восемь побед подряд по максимуму): не наказание, а очередь на глаза человеку.

**Ответ клиенту.** Подозрительный матч не исчезает и автоматически не наказывается:
```json
{ "ok": true, "replay": false, "matchId": "mt_01J8…",
  "result": { "win": true, "ratingBefore": 1000, "ratingDelta": 18, "rating": 1018 },
  "trust": { "suspicious": true, "flags": ["FAST_FINISH"] },
  "progress": { "…": "…" }, "serverTimeUtc": "…" }
```
`trust` есть и в повторе (`replay: true`) — повтор не считается «чистым» по умолчанию. Клиент может показать мягкое пояснение, но не должен блокировать экран результата: вердикт — за оператором в CRM (`Игроки → Матчи с флагами`).

**Границы.** Пороги (`minPointMs`, `rapidClimbRating`, окно часа) живут в `PROGRESS_LIMITS` в `src/routes/clientRoutes.js`, не в клиенте, и меняются без релиза бандла. Флаг — сигнал, не приговор: автоматических банов нет, каждое решение оператора попадает в hash-chain аудит.

---

## 4. WebSocket `/ws/client`

```
wss://<node>/ws/client?ticket=<одноразовый тикет>       // основной путь
wss://<node>/ws/client?affinity=<affinityToken>         // реконнект активной партии
```
Без валидного тикета/affinity сервер отвечает `401` и закрывает соединение.

**Первый кадр (text/JSON):**
```json
{ "type": "welcome", "serverTs": 1793187723446, "sessionId": "ses_…", "playerId": "plr_0091",
  "region": "RU", "nodeId": "ru-msk-tma-01", "keepAliveSec": 25, "warnThresholdMs": 100,
  "ticketValidated": true, "reconnectedSessionId": null }
```

| Правило | Значение |
|---|---|
| Keep-alive | сервер шлёт ping каждые **25 с** (диапазон ТЗ 20–30 с) |
| Клиентский ping | раз в 5 с для измерения RTT; тишина > 45 с → переподключение |
| Backoff | 0.5 → 1 → 2 → 4 → 8 с, максимум 8 с, снова с новым тикетом |
| Размер кадра | входящий буфер ограничен 128 КБ, превышение — разрыв |
| Формат | текстовые JSON-кадры для управления, бинарные — для сжатых дельт физики |
| RTT-коридоры | `<35` отлично · `35–65` хорошо · `65–100` играбельно (rollback) · `100–150` предупреждение клиенту · `>150` PvP запрещён |
| Предсказание | клиент симулирует 60 Гц локально и реконсилирует по серверному состоянию; авторитетен сервер |

Клиент **не** отправляет результат матча и не считает очки экономики.

---

## 5. Ошибки и лимиты

| HTTP | `error` | Когда | Что делать клиенту |
|---|---|---|---|
| 401 | `PLAYER_AUTH_REQUIRED` | нет/истёк `playerToken` | повторить `/auth/telegram` |
| 401 | `INVALID_TELEGRAM_INIT_DATA` | подпись/`auth_date` неверны | переоткрыть Mini App |
| 403 | `ACCOUNT_BANNED` | бан | показать причину, выйти |
| 403 | `PLAYER_RESTRICTED` | заморозка | показать статус |
| 403 | `AGE_CONSENT_REQUIRED` | нет согласия/опекуна | экран согласий |
| 404 | `SESSION_NOT_FOUND` / `TICKET_NOT_FOUND` | объект чужой или удалён | начать новую сессию |
| 400 | `REQUEST_TYPE_INVALID` | DSAR с неизвестным `requestType` | предложить `export`/`erasure` |
| 409 | `REQUEST_ALREADY_OPEN` | такой DSAR уже в очереди | не дублировать, показать «уже обрабатывается» |
| 422 | `INVALID_TELEMETRY_BATCH` | физика/инварианты | логировать `reasons[]`, не ретраить бесконечно |
| 429 | `RATE_LIMITED`, `TELEMETRY_RATE_LIMITED`, `SESSION_START_RATE_LIMITED` | превышен лимит | ждать `Retry-After` / `retryAfterSec` |
| 451 | `REGION_BLOCKED` | `CN` без ICP | экран недоступности |
| 503 | `MAINTENANCE_ACTIVE` | техработы | баннер + `Retry-After` |

Лимиты по умолчанию: телеметрия `120` пакетов/мин на IP, старт сессии `20`/мин на игрока, вход `30`/мин на IP, админ-API `240`/мин, запросы субъекта ПДн `5`/мин на клиента.

---

## 6. Чек-лист реализации клиента

1. **Правила не хардкодить.** `matchRules` приходит из `bootstrap`, версия — из `matchRules.version`; при расхождении версий сервер считает телеметрию по своей версии и помечает событие.
2. **`clientEventId` генерировать до отправки** (UUID/ULID) и хранить в очереди — это делает повтор безопасным.
3. **Оффлайн-очередь.** Пакеты складывать в IndexedDB, отправлять по 20–50 событий, при `429`/`503` — по `Retry-After`.
4. **Свежесть свайпа.** `hasFreshSwipe` отражает реальное движение; попытка «докрутить» даёт фрод-кейс.
5. **RTT.** Мерить по `ping` и WS-кадрам, показывать предупреждение после 100 мс, отключать PvP после 150 мс.
6. **Реконнект.** Хранить `affinityToken` в памяти вкладки; при возврате из фона — `session/start` с ним, затем новый WS-тикет.
7. **Техработы.** Обрабатывать `503` как штатный режим: баннер, ETA, запрет новых матчей, разрешение доиграть текущий.
8. **Скриншоты тикетов** сжимать до ≤ 40 000 символов data-URL.
9. **Никаких обращений к `/api/admin/*`** и никаких упоминаний ИИ/зон в UI.
10. **Согласия** — блокирующий экран, `declaredAge` не подставлять по умолчанию без действия игрока.
11. **Экран приватности** — две кнопки («получить копию данных», «удалить мой аккаунт»), текст берётся из `message`, без собственных обещаний срока.

---

## 7. Проверка контракта локально

```bash
cd newfolder
npm run seed:reset && npm start        # http://0.0.0.0:4100
curl -s localhost:4100/api/client/v1/ping
curl -s localhost:4100/api/client/v1/bootstrap | head -c 600
curl -s -X POST localhost:4100/api/client/v1/session/start \
  -H 'content-type: application/json' \
  -d '{"playerId":"plr_0091","platform":"tma_android","deviceFingerprint":"dev-1"}'
```
Автоматическая проверка стыка: `npm test -- tests/platform.test.js` (WS-тикет, дедупликация, техработы, тикет-тред).

---

## 8. Что изменилось относительно v2.0

| Область | v2.0 | v3.0 |
|---|---|---|
| Уведомления | только `notifications` в bootstrap | единая лента + `dismiss`, пуши выше новостей |
| WebSocket | `?affinity=` | одноразовый `?ticket=` (60 с) + `affinity` для реконнекта |
| Телеметрия | только `snake_case`, без дедупликации | оба диалекта, `clientEventId`, `dedupedCount` |
| Техработы | плоский `503` | `Retry-After` + вложенный `maintenance` с ETA |
| Поддержка | создание тикета | + список, тред, история статусов |
| Идемпотентность | не описана | `Idempotency-Key` на мутациях |
| Ошибки | текстовые | машинные `error` + `retryAfterSec` |
| Право на данные | не было | `POST /privacy/request` (экспорт/удаление), очередь с 30-дневным SLA на стороне CRM |
