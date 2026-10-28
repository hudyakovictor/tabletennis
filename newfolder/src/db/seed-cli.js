'use strict';

const { getDb, closeDb } = require('./database');
const { seedDatabaseIfEmpty } = require('./seed');

(async () => {
  const force = process.argv.includes('--force');
  const db = getDb();
  const res = await seedDatabaseIfEmpty(db, force);
  console.log('Seed completed:', res);
  closeDb();
})();
