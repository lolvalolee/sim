// scripts/migrate-v9.js — версія сесії для реалтайм-оновлень
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

const info = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);

if (!info.includes('version')) {
  // TEXT — ISO timestamp, оновлюється кожен раз коли лектор щось змінює
  db.exec("ALTER TABLE sessions ADD COLUMN version TEXT NOT NULL DEFAULT ''");
  console.log('✓ Added column sessions.version');
} else {
  console.log('• sessions.version already exists');
}

// Backfill існуючим сесіям ставимо поточну версію
const now = new Date().toISOString();
const updated = db.prepare("UPDATE sessions SET version=? WHERE version IS NULL OR version=''").run(now);
console.log(`✓ Backfilled ${updated.changes} sessions with version`);

console.log('\n✅ Migration v9 complete');
db.close();
