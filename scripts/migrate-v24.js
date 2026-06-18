// scripts/migrate-v24.js — B: детермінований торг. Стан торгу в БД.
// nego_offer — поточна ставка сторони (рухається кроками 50-100, у межах коридору).
// nego_ref — орієнтир (freight_ref) зафіксований на момент початку торгу.
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

const tx = db.transaction(() => {
  // Перевізник — стан торгу в carrier_chats
  if (!hasColumn('carrier_chats', 'nego_offer')) {
    db.exec('ALTER TABLE carrier_chats ADD COLUMN nego_offer INTEGER');
    console.log('✓ carrier_chats.nego_offer');
  }
  if (!hasColumn('carrier_chats', 'nego_ref')) {
    db.exec('ALTER TABLE carrier_chats ADD COLUMN nego_ref INTEGER');
    console.log('✓ carrier_chats.nego_ref');
  }
  if (!hasColumn('carrier_chats', 'nego_step_seed')) {
    db.exec('ALTER TABLE carrier_chats ADD COLUMN nego_step_seed INTEGER');
    console.log('✓ carrier_chats.nego_step_seed');
  }
  // Замовник — стан торгу в order_progress
  if (!hasColumn('order_progress', 'client_nego_offer')) {
    db.exec('ALTER TABLE order_progress ADD COLUMN client_nego_offer INTEGER');
    console.log('✓ order_progress.client_nego_offer');
  }
  if (!hasColumn('order_progress', 'client_nego_ref')) {
    db.exec('ALTER TABLE order_progress ADD COLUMN client_nego_ref INTEGER');
    console.log('✓ order_progress.client_nego_ref');
  }
});
tx();

console.log('\n✅ Migration v24 complete');
db.close();
