'use strict';

/**
 * The trust flags from the match journal only matter if someone is called to look.
 * The sweep is the missing link between "this match looks odd" and "an operator
 * opens the player card": it raises one notification per player per day, never a
 * sanction, and stays quiet for banned or deleted accounts.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-flag-sweep-test-'));
const testDbPath = path.join(tmpDir, 'flag-sweep.sqlite');

const { openDatabase } = require('../src/db/database');
const { seedDatabaseIfEmpty } = require('../src/db/seed');
const { runJob, ensureJobs } = require('../src/services/scheduler');

let db;

function addPlayer(id, status = 'active') {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO players (id, display_name, region, install_source, status, created_at, last_seen_at) VALUES (?, ?, 'RU', 'organic_tma', ?, ?, ?)"
  ).run(id, `Player ${id}`, status, now, now);
}

function addMatch(playerId, { flags = ['FAST_FINISH'], suspicious = 1, ageHours = 0 } = {}) {
  const createdAt = new Date(Date.now() - ageHours * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO matches (id, player_id, mode, player_score, opponent_score, win, rating_before, rating_delta, duration_ms, suspicious, flags_json, created_at)
     VALUES (?, ?, 'career', 11, 4, 1, 1000, 16, 30000, ?, ?, ?)`
  ).run(`mt_${playerId}_${Math.random().toString(36).slice(2, 8)}`, playerId, suspicious, JSON.stringify(flags), createdAt);
}

before(() => {
  db = openDatabase(testDbPath);
  seedDatabaseIfEmpty(db);
  ensureJobs(db);
  addPlayer('plr_noisy');
  addPlayer('plr_quiet');
  addPlayer('plr_banned', 'banned');
  for (let i = 0; i < 3; i += 1) addMatch('plr_noisy');
  for (let i = 0; i < 2; i += 1) addMatch('plr_quiet');
  for (let i = 0; i < 5; i += 1) addMatch('plr_banned');
  addMatch('plr_quiet', { suspicious: 0, flags: [] }); // clean match never counts
  addMatch('plr_noisy', { ageHours: 30, flags: ['FAST_FINISH'] }); // outside the 24 h window
});

after(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('trust flag sweep', () => {
  it('calls the operator only for players above the threshold and links to the card', async () => {
    const run = await runJob(db, 'match_flag_sweep', { trigger: 'manual', force: true });
    assert.equal(run.ok, true);
    assert.equal(run.status, 'ok');
    assert.equal(run.detail.matches, 10, 'only suspicious matches inside the 24 h window');
    assert.equal(run.detail.notified, 1, 'plr_quiet has 2 flags, plr_banned is excluded');

    const rows = db.prepare("SELECT * FROM admin_notifications WHERE kind = 'fraud'").all();
    assert.equal(rows.length, 1);
    const note = rows[0];
    assert.equal(note.severity, 'warning');
    assert.match(note.title, /plr_noisy|Player plr_noisy/);
    assert.match(note.body, /FAST_FINISH ×3/);
    assert.equal(note.link_hash, '#/players?player=plr_noisy');
  });

  it('deduplicates: a second run in the same window does not repeat the call', async () => {
    const run = await runJob(db, 'match_flag_sweep', { trigger: 'manual', force: true });
    assert.equal(run.ok, true);
    assert.equal(run.detail.notified, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM admin_notifications WHERE kind = 'fraud'").get().c, 1);
  });

  it('escalates to critical when the player crosses ten flagged matches', async () => {
    for (let i = 0; i < 8; i += 1) addMatch('plr_quiet', { flags: ['REPEATED_RESULT'] }); // 2 + 8 = 10
    db.prepare("DELETE FROM admin_notifications WHERE kind = 'fraud'").run();
    const run = await runJob(db, 'match_flag_sweep', { trigger: 'manual', force: true });
    assert.equal(run.detail.notified, 2, 'noisy stays warning, quiet becomes critical');
    const quiet = db
      .prepare("SELECT * FROM admin_notifications WHERE link_hash = '#/players?player=plr_quiet'")
      .get();
    assert.equal(quiet.severity, 'critical');
    assert.match(quiet.body, /REPEATED_RESULT ×8/);
  });
});
