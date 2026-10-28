#!/usr/bin/env node
/* Заполнить БД демо-данными: npm run seed. Не затирает непустую БД без --force. */
import { loadEnvFile, loadConfig } from '../server/config.js';
import { openDb, initUsers, defaultSettings } from '../server/db.js';
import { seedDemoData } from '../server/seed.js';

loadEnvFile(process.env.CRM_ENV_FILE || '.env');
const cfg = loadConfig();
const db = openDb(cfg.dbPath);
initUsers(db, cfg);
defaultSettings(db);
const result = seedDemoData(db, cfg, { force: process.argv.includes('--force') });
console.log(JSON.stringify(result, null, 2));
db.close();
if (!result.seeded) process.exitCode = 2;
