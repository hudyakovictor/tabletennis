# Runbook: INPUT_REJECT_SPIKE

## Триггер
Reject rate ввода выше `alert_thresholds.reject_rate_pct` за 24 часа при достаточной выборке.

## Симптомы
Рост `OUTSIDE_ZONE`, `WRONG_DIRECTION`, `STATIC_CLICK`; жалобы на пропущенные удары; падение успешных розыгрышей.

## Диагностика
1. Открыть **Balance и ввод**, сравнить touch/mouse, rules v3/v4 и сборки.
2. Проверить теплокарту along/across и доминирующий reject code.
3. Открыть **Ops**, сравнить crash rate/FPS по той же сборке.
4. Проверить свежие тикеты и known issues.
5. В игровом CI запустить `npm test`, `npm run test:input`, `npm run test:contact` (из `source/game`).

## Смягчение
- Зафиксировать инцидент и владельца.
- При подтверждённой регрессии вручную вернуть `active_build` на стабильную сборку.
- Изменение `MATCH_RULES` — только после A/B и подтверждения владельца.

## Откат
Вернуть прежние значения в **Настройки → MATCH_RULES**; проверить, что клиентский бэкенд получил старую конфигурацию.

## Эскалация
Critical при затронутых >30% touch-сессий или одновременном росте крэшей. После Sev-1/Sev-2 — blameless post-mortem в инциденте.
