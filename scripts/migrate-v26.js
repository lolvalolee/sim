// scripts/migrate-v26.js — letter_id на біржовому пості (прив'язка до рейсу)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

const tx = db.transaction(() => {
  if (!hasColumn('cargo_board', 'letter_id')) {
    db.exec('ALTER TABLE cargo_board ADD COLUMN letter_id TEXT');
    console.log('✓ cargo_board.letter_id');
  } else {
    console.log('• letter_id вже існує');
  }
});
tx();

console.log('\n✅ Migration v26 complete');
db.close();
