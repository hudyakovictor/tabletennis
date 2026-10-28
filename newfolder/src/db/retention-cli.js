'use strict';

const { getDb, closeDb, runRetentionCleanup } = require('./database');

const db = getDb();
const res = runRetentionCleanup(db);
console.log('Retention policy cleanup result:', res);
closeDb();
