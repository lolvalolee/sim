// migrate-v4.js — додає колонку for_exchange у carriers і ЧИСТИТЬ стару базу
// Запускається ОДИН РАЗ перед seed-carriers.js + seed-exchange-carriers.js
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// 1. Додати колонку for_exchange якщо її ще нема
const info = db.prepare("PRAGMA table_info(carriers)").all();
const cols = info.map(c => c.name);

if (!cols.includes('for_exchange')) {
  db.exec(`ALTER TABLE carriers ADD COLUMN for_exchange INTEGER DEFAULT 0`);
  console.log('✓ Added column carriers.for_exchange');
} else {
  console.log('• Column carriers.for_exchange already exists');
}

// 2. ВИДАЛИТИ всі поточні перевізники
// (бо ми перезаливаємо повністю — 400 довідникових + 200 біржових)
const before = db.prepare("SELECT COUNT(*) as c FROM carriers").get().c;
db.exec(`DELETE FROM carriers`);
console.log(`✓ Cleared ${before} old carrier(s) — ready for fresh seed`);

// 3. Перевірка — таблиця має бути порожня
const after = db.prepare("SELECT COUNT(*) as c FROM carriers").get().c;
console.log(`• carriers count now: ${after}`);

console.log('\n✅ Migration v4 complete. Now run:');
console.log('   node seed-carriers.js          (400 довідникових)');
console.log('   node seed-exchange-carriers.js (200 біржових)');
db.close();
