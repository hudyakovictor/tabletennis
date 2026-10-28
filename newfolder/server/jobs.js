/* Фоновые задания. Каждое задание защищено от наложения и ошибок:
 * падение провайдера/детектора не останавливает HTTP-сервер. */
import { evaluateAlerts } from './alerts.js';
import { scanActivePlayers } from './fraud.js';
import { runZoneAnalysis } from './ai/zones.js';
import { archiveOldChat } from './ai/director.js';
import { runRetention } from './actions.js';
import { nowISO } from './util.js';

export function createJobs(db, cfg, bot, logger = console) {
  const timers = [];
  const running = new Set();
  const last = {};
  const safe = (name, fn) => async () => {
    if (running.has(name)) return;
    running.add(name);
    try { last[name] = { at: nowISO(), result: await fn() }; }
    catch (e) { last[name] = { at: nowISO(), error: String(e.message).slice(0, 300) }; logger.error(`[job:${name}]`, e.message); }
    finally { running.delete(name); }
  };
  const every = (name, minutes, fn, immediate = false) => {
    const task = safe(name, fn);
    const t = setInterval(task, Math.max(1, minutes) * 60e3);
    t.unref?.(); timers.push(t);
    if (immediate) setTimeout(task, 1500).unref?.();
  };

  function start() {
    if (!cfg.jobsEnabled || timers.length) return;
    every('alerts', cfg.alertsEvalMinutes, async () => {
      const result = evaluateAlerts(db);
      if (bot && result.created.length) {
        for (const id of result.created) {
          const alert = db.prepare('SELECT * FROM alerts WHERE id=?').get(id);
          if (alert && alert.level !== 'info') await bot.notifyAlert(alert);
        }
      }
      return result;
    }, true);
    every('fraud-scan', 60, async () => scanActivePlayers(db), false);
    for (const zone of ['ops', 'fraud', 'balance', 'market', 'lab']) {
      every(`zone-${zone}`, cfg.ai[zone].cadenceMinutes, () => runZoneAnalysis(db, cfg, zone, { actor: 'scheduler', createProposal: true }), false);
    }
    every('chat-archive', 60, async () => archiveOldChat(db, cfg), false);
    every('retention', 1440, async () => runRetention(db, cfg), false);
    if (bot) every('daily-digest', 60, async () => {
      const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: cfg.timezone }).format(new Date()));
      const key = new Date().toISOString().slice(0, 10);
      if (hour === cfg.bot.dailyDigestHour && last.digestDay !== key) {
        last.digestDay = key;
        return bot.dailyDigest();
      }
      return { skipped: true };
    }, false);
  }
  function stop() { for (const t of timers) clearInterval(t); timers.length = 0; }
  return { start, stop, last, running };
}
