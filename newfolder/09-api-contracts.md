# API-контракты

## Общий принцип

Все зоны общаются с директором через структурированные JSON-сводки.

Сырые логи между зонами не передаются.

## Сводка зоны

```json
{
  "zone": "balance",
  "timestamp": "2026-10-27T09:00:00Z",
  "status": "warning",
  "findings": [
    {
      "issue": "рост OUTSIDE_ZONE на быстрых подачах",
      "confidence": 0.82,
      "affected_segment": "touch, Android",
      "recommended_action": "проверить ovalSideTouchPx"
    }
  ],
  "metrics": {
    "reject_rate": 0.34,
    "success_rate": 0.61
  }
}
```

## Запрос владельца к директору

```json
{
  "question": "какие зоны требуют внимания?",
  "time_range": "last_72h"
}
```

## Ответ директора

```json
{
  "status": "warning",
  "summary": "Balance и Ops требуют внимания",
  "findings": [
    {
      "zone": "balance",
      "issue": "рост OUTSIDE_ZONE",
      "confidence": 0.82
    }
  ],
  "next_questions": [
    "показать теплокарту по Android"
  ]
}
```

## Правила

- все ответы валидируются по JSON Schema;
- невалидный ответ — в карантин;
- зоны не видят чат друг с другом;
- директор не видит сырые логи;
- все действия требуют подтверждения человека.
