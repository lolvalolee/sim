// scripts/migrate-v5.js — додає поле rates у groups
// Курси EUR/UAH тепер належать групі (а не тільки сесії)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

const DEFAULT_RATES = '[41.5,41.65,41.8,41.7,41.9]';

// Додати rates колонку
const info = db.prepare("PRAGMA table_info(groups)").all().map(c => c.name);
if (!info.includes('rates')) {
  db.exec(`ALTER TABLE groups ADD COLUMN rates TEXT NOT NULL DEFAULT '${DEFAULT_RATES}'`);
  console.log('✓ Added column groups.rates with default ' + DEFAULT_RATES);
} else {
  console.log('• Column groups.rates already exists');
}

// Backfill для груп з NULL/порожнім rates — дефолтні курси
const nullRates = db.prepare("SELECT COUNT(*) as c FROM groups WHERE rates IS NULL OR rates=''").get().c;
if (nullRates > 0) {
  db.prepare("UPDATE groups SET rates=? WHERE rates IS NULL OR rates=''").run(DEFAULT_RATES);
  console.log(`✓ Backfilled ${nullRates} group(s) with default rates`);
}

console.log('\n✅ Migration v5 complete');
db.close();
