// migrate-v29.js — letter_id у application_followups (нагадування без заявки)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

if (!hasColumn('application_followups', 'letter_id')) {
  db.exec('ALTER TABLE application_followups ADD COLUMN letter_id TEXT');
  console.log('✓ application_followups.letter_id');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_followups_letter ON application_followups(session_id, letter_id, carrier_id)');

console.log('\n✅ Migration v29 complete');
db.close();
