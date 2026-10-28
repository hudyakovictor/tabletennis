/* Telegram-бот: второй канал CRM, только чтение + Ack алерта.
 * Токен только на сервере. Разрешены chat_id из BOT_CHAT_IDS, остальные молча
 * игнорируются. Никаких команд смены правил, банов, пушей или настроек. */
import * as M from './metrics.js';
import { overview, economy, fraudMetrics, aiMetrics, ops } from './metrics.js';
import { setAlertStatus } from './alerts.js';
import { esc, cleanStr } from './util.js';

export function createBot(db, cfg) {
  let timer = null;
  let offset = 0;
  let stopped = true;
  let polling = false;
  const state = { enabled: cfg.bot.enabled, lastUpdate: null, lastError: null, updates: 0 };

  async function api(method, payload = {}) {
    if (!cfg.bot.enabled) throw new Error('Telegram bot is disabled');
    const res = await fetch(`https://api.telegram.org/bot${cfg.bot.token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(`Telegram ${method}: ${json.description || res.status}`);
    return json.result;
  }

  const allowed = (chatId) => cfg.bot.chatIds.includes(String(chatId));
  async function send(chatId, text, extra = {}) {
    if (!allowed(chatId)) return null;
    return api('sendMessage', { chat_id: chatId, text: String(text).slice(0, 3900), parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  }

  async function broadcast(text, extra = {}) {
    const results = [];
    for (const chatId of cfg.bot.chatIds) {
      try { results.push(await send(chatId, text, extra)); }
      catch (e) { state.lastError = String(e.message).slice(0, 200); results.push({ error: state.lastError }); }
    }
    return results;
  }

  function kpi(o, key) { return o.kpis.find(k => k.key === key)?.value ?? 0; }

  async function command(chatId, raw) {
    if (!allowed(chatId)) return;
    const [cmdRaw, ...args] = cleanStr(raw, 300).split(/\s+/);
    const cmd = cmdRaw.toLowerCase().replace(/@[\w_]+$/, '');
    const o = overview(db, '24h');
    if (cmd === '/start' || cmd === '/help') {
      return send(chatId, [
        '<b>TOPSPIN ARENA CRM</b>', 'Только чтение, изменения игры недоступны.', '',
        '/status — общее состояние', '/ping — пинг по регионам', '/errors — последние ошибки',
        '/players — DAU и сессии', '/revenue — выручка за сегодня', '/ai — статус ИИ-зон',
        '/fraud — открытые кейсы', '/alerts — открытые алерты',
        cfg.bot.ackEnabled ? '/ack ID — подтвердить алерт' : '',
      ].filter(Boolean).join('\n'));
    }
    if (cmd === '/status') {
      const critical = o.alerts.filter(a => a.level === 'critical').length;
      return send(chatId, [
        `<b>Состояние: ${critical ? '🔴 CRITICAL' : o.alerts.length ? '🟡 WARNING' : '🟢 OK'}</b>`,
        `Игроки 24ч: <b>${kpi(o, 'players')}</b> · Сессии: <b>${kpi(o, 'sessions')}</b>`,
        `Выручка: <b>$${kpi(o, 'revenue')}</b> · FPS: <b>${kpi(o, 'fps')}</b>`,
        `Отказы ввода: <b>${kpi(o, 'reject_rate')}%</b> · Крэши: <b>${kpi(o, 'crashes')}</b>`,
        `Открытые алерты: ${o.alerts.length} (critical: ${critical})`,
        ...o.openIncidents.slice(0, 3).map(i => `• ${esc(i.title)}`),
      ].join('\n'));
    }
    if (cmd === '/ping') {
      const d = ops(db, '24h');
      return send(chatId, ['<b>Пинг по регионам (24ч)</b>', ...(d.pings.length ? d.pings.map(p => `${esc(p.region)}: <b>${Math.round(p.ping_ms)} мс</b> · ${p.samples} замеров`) : ['Нет данных']), `p95 HTTP: ${d.golden.latency.p95} мс`].join('\n'));
    }
    if (cmd === '/errors') {
      const d = ops(db, '24h');
      return send(chatId, ['<b>Ошибки за 24 часа</b>', ...(d.errors.length ? d.errors.slice(0, 10).map(e => `• <code>${esc(e.code)}</code> [${esc(e.level)}] — ${e.n}`) : ['Ошибок нет'])].join('\n'));
    }
    if (cmd === '/players') {
      return send(chatId, [`<b>Игроки</b>`, `Активные 24ч: <b>${kpi(o, 'players')}</b>`, `Сессии: <b>${kpi(o, 'sessions')}</b>`, `Fraud-кейсы: <b>${kpi(o, 'fraud')}</b>`].join('\n'));
    }
    if (cmd === '/revenue') {
      const e = economy(db, '24h');
      return send(chatId, [`<b>Выручка за 24 часа</b>`, `$<b>${e.totals.revenue}</b> · платежей: ${e.totals.payments}`, `Платящих: ${e.totals.payers} · возвраты: ${e.totals.refunds}`, ...e.products.slice(0, 5).map(p => `• ${esc(p.product_id)}: $${p.revenue} (${p.n})`)].join('\n'));
    }
    if (cmd === '/ai') {
      const a = aiMetrics(db, cfg, '24h');
      return send(chatId, ['<b>ИИ-зоны</b>', ...a.zones.map(z => `${esc(z.zone)}: ${esc(z.lastSummary?.status || 'нет сводки')} · ${z.usedToday}/${z.dailyLimit} tok · ${z.provider}`), `Карантин: ${a.totals.quarantined}`].join('\n'));
    }
    if (cmd === '/fraud') {
      const f = fraudMetrics(db, '7d');
      return send(chatId, ['<b>Fraud</b>', `Открыто: <b>${f.totals.open || 0}</b> · подтверждено: ${f.totals.confirmed || 0} · ложных: ${f.totals.false_positive || 0}`, ...f.cases.filter(c => c.status === 'open').slice(0, 5).map(c => `• <code>${esc(c.id.slice(0, 8))}</code> risk ${c.risk_score} — ${esc(c.reasons[0] || '')}`), 'Решения принимаются только в CRM.'].join('\n'));
    }
    if (cmd === '/alerts') {
      return send(chatId, ['<b>Открытые алерты</b>', ...(o.alerts.length ? o.alerts.map(a => `${a.level === 'critical' ? '🔴' : '🟡'} <code>${esc(a.id.slice(0, 8))}</code> ${esc(a.title)}`) : ['Нет открытых алертов'])].join('\n'));
    }
    if (cmd === '/ack' && cfg.bot.ackEnabled) {
      const prefix = args[0];
      const alert = prefix && db.prepare('SELECT * FROM alerts WHERE id LIKE ?').get(`${prefix}%`);
      if (!alert) return send(chatId, 'Алерт не найден. Используйте /ack ID из /alerts.');
      setAlertStatus(db, alert.id, 'ack', `telegram:${chatId}`);
      return send(chatId, `Алерт <code>${esc(alert.id.slice(0, 8))}</code> подтверждён. Игра не изменялась.`);
    }
    return send(chatId, 'Неизвестная команда. /help');
  }

  async function poll() {
    if (polling || stopped) return;
    polling = true;
    try {
      const updates = await api('getUpdates', { offset, timeout: 20, allowed_updates: ['message'] });
      for (const u of updates || []) {
        offset = Math.max(offset, u.update_id + 1);
        state.updates++;
        state.lastUpdate = new Date().toISOString();
        const msg = u.message;
        if (msg?.text?.startsWith('/')) await command(msg.chat.id, msg.text);
      }
      state.lastError = null;
    } catch (e) {
      state.lastError = String(e.message).slice(0, 250);
      await new Promise(r => setTimeout(r, 3000));
    } finally { polling = false; }
  }

  function start() {
    if (!cfg.bot.enabled || timer) return;
    stopped = false;
    const loop = async () => { if (!stopped) await poll(); };
    timer = setInterval(loop, 25000);
    timer.unref?.();
    loop();
  }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }

  async function notifyAlert(alert) {
    const icon = alert.level === 'critical' ? '🔴 CRITICAL' : alert.level === 'warning' ? '🟡 WARNING' : 'ℹ️ INFO';
    return broadcast([`<b>${icon}</b> ${esc(alert.title)}`, esc(alert.message), `Зона: ${esc(alert.zone)} · <code>${esc(alert.id.slice(0, 8))}</code>`, alert.runbook ? `Runbook: ${esc(alert.runbook)}` : '', 'Команда: /ack ' + alert.id.slice(0, 8)].filter(Boolean).join('\n'));
  }

  async function notifyPush(push) {
    const channels = typeof push.channels === 'string' ? JSON.parse(push.channels) : push.channels;
    if (!channels?.includes('telegram')) return [];
    return broadcast([`<b>${push.level === 'critical' ? 'ВАЖНО' : 'TOPSPIN ARENA'}</b>`, `<b>${esc(push.title)}</b>`, esc(push.body)].join('\n'));
  }

  async function dailyDigest() {
    const o = overview(db, '24h');
    return broadcast([
      '<b>Ежедневная сводка TOPSPIN ARENA</b>',
      `Игроки: ${kpi(o, 'players')} · сессии: ${kpi(o, 'sessions')} · выручка: $${kpi(o, 'revenue')}`,
      `FPS: ${kpi(o, 'fps')} · отказы ввода: ${kpi(o, 'reject_rate')}% · крэши: ${kpi(o, 'crashes')}`,
      `Открытые алерты: ${o.alerts.length} · fraud: ${kpi(o, 'fraud')} · предложения: ${o.pendingProposals}`,
      'Подробности: /status /errors /ai /fraud',
    ].join('\n'));
  }

  return { start, stop, state, send, broadcast, command, notifyAlert, notifyPush, dailyDigest };
}
