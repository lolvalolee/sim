// scripts/migrate-v25.js — Варіант 2: закріплення рейсу за чатом перевізника.
// carrier_chats.locked_letter_id — внутрішній технічний зв'язок "цей чат веде
// розмову про цей рейс". Студент НЕ бачить. Закріплення ≠ угода (угода — session_deals).
// Один чат = один рейс = один торг (прибирає плутанину "два рейси в одному чаті").
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

const tx = db.transaction(() => {
  if (!hasColumn('carrier_chats', 'locked_letter_id')) {
    db.exec('ALTER TABLE carrier_chats ADD COLUMN locked_letter_id TEXT');
    console.log('✓ carrier_chats.locked_letter_id (закріплений рейс)');
  } else {
    console.log('• locked_letter_id вже існує');
  }
});
tx();

console.log('\n✅ Migration v25 complete');
db.close();
