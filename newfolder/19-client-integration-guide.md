# Руководство по подключению будущего игрового клиента к Admin CRM (`v2.0`)

Документ предназначен для интеграции **будущего чистого рерайта клиента TOPSPIN ARENA** (Telegram Mini App / WebGL / Mobile Web) с серверным контуром `newfolder/`.

> **Железный архитектурный инвариант (`01-architecture.md`):**  
> Игровой клиент общается **только** с публичным игровым контуром `/api/client/v1/*` и WebSocket-шлюзом `/ws/client`.  
> Клиент **никогда** не получает API-ключи, системные промпты, сводки ИИ-зон или доступ к `/api/admin/*` (запросы с игровых доменов на `/api/admin/*` жёстко блокируются сервером с кодом `403 FORBIDDEN_ADMIN_ORIGIN`).

---

## 1. Схема жизненного цикла клиентской сессии

```text
[1. Старт TMA / Web]
       │
       ▼
GET /api/client/v1/bootstrap          ──► Получить 35 полей MATCH_RULES, A/B вариант,
       │                                  статус техработ, пуши, новости, региональный узел,
       │                                  порог предупреждения пинга (>100 мс) и правила возраста
       ▼
POST /api/client/v1/auth/telegram     ──► Передать Telegram.WebApp.initData (HMAC-SHA256),
       │                                  получить playerToken и playerId
       ▼
POST /api/client/v1/legal/consent     ──► При первом входе / смене версии документов передать
       │                                  возраст и явные opt-in согласия (COPPA 13 / GDPR-K 16 / 152-ФЗ 14)
       ▼
POST /api/client/v1/session/start     ──► Начать сессию (или восстановить при обрыве через affinityToken);
       │                                  при техработах для НОВЫХ матчей вернётся HTTP 503
       ▼
WS  /ws/client?affinity=<token>       ──► Держать соединение (keep-alive 25с, бинарные и JSON кадры,
       │                                  измерение RTT в реальном времени)
       ▼
POST /api/client/v1/telemetry/inputs  ──► Пакетная отправка телеметрии свайпов каждые 3–5 сек
       │                                  (проходит 6-точечную серверную проверку физики и свежести свайпа)
       ▼
POST /api/client/v1/telemetry/session-end ──► Финальные FPS, p50/p95 RTT, флаги краша и WebGL loss
```

---

## 2. Контракты REST-эндпоинтов клиента (`/api/client/v1/*`)

### 2.1. `GET /api/client/v1/bootstrap`
Вызывается до входа в матч. Для игроков из юрисдикции `CN` при отсутствии лицензии ICP (`CN_ICP_LICENSED != 1`) сервер возвращает **`451 Unavailable For Legal Reasons`**.

Пример ответа `200 OK`:
```json
{
  "serverTimeUtc": "2026-10-28T09:00:00.000Z",
  "region": "RU",
  "recommendedEndpoint": {
    "nodeId": "ru-msk-tma-01",
    "code": "ru-msk-1",
    "wsUrl": "wss://msk.game.topspin.arena/ws/client",
    "targetRttMs": 38
  },
  "wsEndpoint": "/ws/client",
  "pingThresholds": {
    "excellentMaxMs": 35,
    "goodMaxMs": 65,
    "playableRollbackMaxMs": 100,
    "warnClientThresholdMs": 100,
    "poorWarnMaxMs": 150
  },
  "ageGate": {
    "minAgeWithoutParentalConsent": 14,
    "law": "152-ФЗ / ГК РФ"
  },
  "maintenance": {
    "enabled": false,
    "bannerRu": "",
    "etaIso": null
  },
  "matchRules": {
    "version": 4,
    "zoneShape": "oval",
    "pressRadiusPx": 96,
    "ovalForwardMaxPx": 120,
    "contactSideTouchPx": 64
  },
  "abVariant": "oval_touch_plus8_treatment",
  "notifications": [],
  "news": [],
  "legalDocuments": []
}
```

### 2.2. `POST /api/client/v1/auth/telegram`
Проверяет криптографическую подпись `window.Telegram.WebApp.initData` по спецификации Telegram (`HMAC_SHA256("WebAppData", BOT_TOKEN)`).

Тело запроса:
```json
{
  "initData": "query_id=...&user=%7B%22id%22%3A123456%7D&auth_date=1793178000&hash=...",
  "installSource": "telegram_ads",
  "installCampaign": "tma_spin_masters_q4",
  "installCreative": "cr_tma_spin_video"
}
```
Ответ возвращает `playerToken` (передавать в заголовке `Authorization: Bearer <playerToken>`).

### 2.3. `POST /api/client/v1/legal/consent` (Возрастной фильтр и явный Opt-In)
Клиент обязан показать чекбоксы согласия **снятыми по умолчанию** (`analyticsOptIn: false`, `marketingOptIn: false`) и передать возраст игрока:
- **РФ (`RU`)**: до `14` лет без `parentalConsent: true` вернётся `403 PARENTAL_CONSENT_REQUIRED` (`152-ФЗ / ГК РФ`).
- **ЕС (`EU`)**: до `16` лет без `parentalConsent: true` вернётся `403 PARENTAL_CONSENT_REQUIRED` (`GDPR-K`).
- **США (`US`)**: до `13` лет без `parentalConsent: true` вернётся `403 PARENTAL_CONSENT_REQUIRED` (`COPPA`).

### 2.4. `POST /api/client/v1/session/start` и Reconnect Session Affinity
- **Новая сессия**: передаётся `{ "playerId": "...", "platform": "tma_ios" | "tma_android" | "web_desktop", "deviceFingerprint": "..." }`.
  В ответе (`201 Created`) приходит подписанный `affinityToken` и `sessionId`.
- **Реконнект при смене Wi-Fi -> LTE или кратковременных техработах**: клиент передаёт `{ "playerId": "...", "affinityToken": "<сохранённый токен>" }`. Сервер проверяет HMAC-подпись и возвращает `200 OK` (`reconnected: true`), **даже если параллельно включился режим техработ** (чтобы текущая партия корректно доигралась!).
- **Блокировка новых матчей в техработы**: если `affinityToken` не передан и включён `maintenance_mode`, сервер возвращает `503 Service Unavailable` с текстом баннера и `etaIso`.

### 2.5. `POST /api/client/v1/telemetry/inputs` (Пакетная отправка ударов и свайпов)
Клиент буферизует события нажатий/свайпов и отправляет пакет раз в 3–5 секунд (до 200 событий в пакете).

Пример валидного пакета:
```json
{
  "sessionId": "ses_01ab23cd45ef6789",
  "events": [
    {
      "ts": "2026-10-28T09:02:11.420Z",
      "pointer_type": "touch",
      "grip": "shakehand",
      "hand": "right",
      "is_serve": false,
      "table_zone": "deep_bh",
      "has_fresh_swipe": true,
      "swipe_straightness": 0.84,
      "along": -34.5,
      "across": 22.0,
      "accepted": true,
      "contact": true,
      "is_grace": false,
      "reject_code": null,
      "stroke_type": "backhand_flick",
      "ball_speed": 16.8,
      "spin": 340.5,
      "reaction_ms": 218.0,
      "sweet_spot_dist": 0.14,
      "rules_version": 4,
      "ab_variant": "oval_touch_plus8_treatment"
    }
  ]
}
```

#### Обязательные справочники движка:
1. **`table_zone` (6 зон стола)**: `'short_bh'`, `'short_mid'`, `'short_fh'`, `'deep_bh'`, `'deep_mid'`, `'deep_fh'`.
2. **`reject_code` (10 канонических причин отказа из `12_match_rules.js`)**:
   - `'OUTSIDE_ZONE'`
   - `'NO_FRESH_SWIPE'`
   - `'STATIC_CLICK'`
   - `'DEPTH_FAIL'`
   - `'TIMING_LATE'`
   - `'TIMING_EARLY'`
   - `'CONSUMED'`
   - `'SERVE_TOSS_LOW'`
   - `'WRONG_DIRECTION'`
   - `'BOUNCE_ILLEGAL'`

#### 6 инвариантов серверного анти-тампер валидатора (`src/security/validator.js`):
Пакет отклоняется (`422`), а сессия помечается антифрод-сигналом `packet_tamper_attempt` (на ручную проверку администратору), если нарушено любое из условий:
1. Частота событий превышает `25 событий/сек` в скользящем секундном окне.
2. Скорость мяча `> 38.0 м/с`, вращение `|spin| > 1150 рад/с` или реакция `< 15 мс`.
3. Временная метка `ts` из будущего (`> +60с`) или немонотонна.
4. Заявлен `contact: true`, но смещение ракетки `|along| > 260 px` или `|across| > 180 px`.
5. Заявлен `accepted: true` при `has_fresh_swipe: false`.
6. Заявлен `accepted: true` одновременно с ненулевым `reject_code`.

### 2.6. `POST /api/client/v1/support/tickets` (Обращения в поддержку со скриншотом)
Позволяет игроку прямо из меню паузы отправить баг-репорт или вопрос по платежу со скриншотом (`data:image/png;base64,...`) и автоматическим контекстом (`sessionId`, `rttMs`, `platform`, `rulesVersion`). Критичные тикеты мгновенно эскалируются дежурному в Telegram-бот.

---

## 3. Низколатентный WebSocket-протокол `/ws/client` (`13-telegram-miniapp-latency.md`)

Подключение:
```javascript
const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/client?affinity=${encodeURIComponent(affinityToken)}`);
ws.binaryType = 'arraybuffer';
```

1. **Приветственный кадр (`welcome`)**: сразу после `101 Switching Protocols` сервер присылает `serverTs`, `nodeId`, `keepAliveSec: 25` и `warnThresholdMs: 100`.
2. **Keep-Alive в Telegram WebView**: каждые **25 секунд** сервер отправляет RFC 6455 `Ping` (`0x09`), чтобы мобильный NAT оператора и Telegram Mini App не усыпляли соединение между розыгрышами.
3. **Компактные бинарные кадры (`0x02`)**: клиент может слать бинарный буфер состояния/ввода; сервер без аллокации JSON возвращает 8-байтный `BigUInt64BE` серверный таймстамп + заголовок пакета.
4. **Клиентская индикация пинга (`13-telegram-miniapp-latency.md`)**:
   - `< 35 мс` — зелёный индикатор (идеально)
   - `35–65 мс` — зелёный (целевой диапазон TMA)
   - `65–100 мс` — жёлтый (включить клиентский rollback-буфер предсказания)
   - **`> 100 мс` (`100–150 мс`)** — показать ненавязчивое предупреждение о нестабильной сети
   - `> 150 мс` — предложить одиночный режим против ИИ вместо рейтингового PvP
