import { overview, ops, alerts } from './views-core.js';
import { balance, market, economy, players } from './views-analysis.js';
import { ai, director, proposals, fraud, lab } from './views-ai.js';
import { liveops, tickets, content } from './views-liveops.js';
import { settings, integration } from './views-system.js';

export const views = { overview, ops, alerts, balance, market, economy, players, ai, director, proposals, fraud, lab, liveops, tickets, content, settings, integration };

export const routeMeta = {
  overview: { title: 'Обзор', subtitle: 'Ключевые метрики игры и состояние всех зон' },
  ops: { title: 'Ops', subtitle: 'Четыре золотых сигнала, FPS, крэши и ошибки' },
  alerts: { title: 'Алерты и инциденты', subtitle: 'Детекторы, runbooks и ручное управление инцидентами', noRange: true },
  balance: { title: 'Balance и ввод', subtitle: 'Отказы свайпов, теплокарты, MATCH_RULES и сегменты' },
  market: { title: 'Маркетинг', subtitle: 'Каналы, когорты, retention, CAC, LTV и ROAS' },
  economy: { title: 'Экономика', subtitle: 'Платежи, продукты и sink/source валюты' },
  players: { title: 'Игроки', subtitle: 'Профили, сессии, платежи, согласия и удаление ПДн', noRange: true },
  ai: { title: 'ИИ-зоны', subtitle: 'Изолированные провайдеры, лимиты, стоимость и карантин' },
  director: { title: 'Директор', subtitle: 'Чат владельца на основе сводок зон', noRange: true },
  proposals: { title: 'Предложения', subtitle: 'Human-in-the-loop: одобрение и исполнение решений', noRange: true },
  fraud: { title: 'Fraud', subtitle: 'Risk score и ручной разбор кейсов' },
  lab: { title: 'Lab и A/B', subtitle: 'Гипотезы, варианты, результаты и тестовые прогоны' },
  liveops: { title: 'Техработы и новости', subtitle: 'Maintenance, приоритетные пуши и новостная лента', noRange: true },
  tickets: { title: 'Поддержка', subtitle: 'Тикеты игроков, статусы и ответы', noRange: true },
  content: { title: 'Контент-план', subtitle: 'Патчи, ивенты и план обновлений', noRange: true },
  integration: { title: 'Подключение', subtitle: 'Контракты ingestion и клиентских API', noRange: true },
  settings: { title: 'Настройки и аудит', subtitle: 'Конфигурация, безопасность и журнал действий', noRange: true },
};
