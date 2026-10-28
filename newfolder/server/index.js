#!/usr/bin/env node
/* Точка входа CRM. Запуск: npm start (Node.js 22.5+). */
import http from 'node:http';
import { loadConfig, loadEnvFile } from './config.js';
import { openDb, initUsers, defaultSettings } from './db.js';
import { createAuth } from './auth.js';
import { createRouter } from './router.js';
import { createBot } from './bot.js';
import { createJobs } from './jobs.js';
import { seedDemoData } from './seed.js';

export function createRuntime(options = {}) {
  const cfg = options.cfg || loadConfig(process.env, options.configOverrides || {});
  const db = options.db || openDb(cfg.dbPath, { memory: cfg.dbPath === ':memory:' });
  const userInit = initUsers(db, cfg);
  defaultSettings(db);
  let seedResult = null;
  if (options.seed ?? cfg.demoData) {
    try { seedResult = seedDemoData(db, cfg); }
    catch (e) { console.error('[seed] failed:', e.stack || e.message); }
  }
  const auth = createAuth(db, cfg);
  const bot = createBot(db, cfg);
  const jobs = createJobs(db, cfg, bot, options.logger || console);
  const router = createRouter({ db, cfg, auth, bot, jobs, logger: options.logger || console });
  const server = http.createServer(router.handle);
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  server.keepAliveTimeout = 5000;
  return {
    cfg, db, auth, bot, jobs, router, server, seedResult, generatedPassword: userInit.password,
    start() {
      if (cfg.jobsEnabled) jobs.start();
      if (cfg.bot.enabled) bot.start();
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(cfg.port, cfg.host, () => resolve(server.address()));
      });
    },
    async stop() {
      jobs.stop(); bot.stop(); router.close();
      if (server.listening) await new Promise(resolve => server.close(resolve));
      if (!options.db) db.close();
    },
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain || process.argv[1]?.endsWith('/server/index.js') || process.argv[1]?.endsWith('server/index.js')) {
  loadEnvFile(process.env.CRM_ENV_FILE || '.env');
  const runtime = createRuntime();
  const { cfg, generatedPassword, seedResult } = runtime;
  await runtime.start();
  console.log(`\nTOPSPIN ARENA CRM ${cfg.version}`);
  console.log(`URL: http://${cfg.host}:${cfg.port}  (env: ${cfg.envName})`);
  console.log(`DB: ${cfg.dbPath}`);
  console.log(`Demo data: ${seedResult?.seeded ? `${seedResult.accepted} events, ${seedResult.players} players` : 'existing / disabled'}`);
  console.log(`AI: ${Object.values(cfg.ai).filter(z => z.apiKey).length} zones with external keys; others use local deterministic provider`);
  console.log(`Telegram bot: ${cfg.bot.enabled ? 'enabled' : 'disabled'}`);
  if (generatedPassword) {
    console.log('\n=== INITIAL ADMIN CREDENTIALS (shown once) ===');
    console.log(`Login: ${cfg.adminUser}\nPassword: ${generatedPassword}`);
    console.log('Set ADMIN_PASSWORD in .env and change the password in Settings.');
  }
  const shutdown = async (signal) => {
    console.log(`\n${signal}: stopping CRM...`);
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
