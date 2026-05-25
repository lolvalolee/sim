// scripts/migrate-v13.js — таблиця нагадувань + поля надсилання заявок
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// ── 1. Нові колонки в applications ──
const appsInfo = db.prepare("PRAGMA table_info(applications)").all().map(c => c.name);

const newAppCols = [
  ['sent_to_carrier_at',     'TEXT'],           // момент надсилання (timestamp)
  ['sent_to_carrier_id',     'TEXT'],           // кому надіслано (carrier_id з модалки)
  ['sent_message_id',        'TEXT'],           // ID повідомлення в carrier_chats
];

for (const [col, def] of newAppCols) {
  if (!appsInfo.includes(col)) {
    db.exec(`ALTER TABLE applications ADD COLUMN ${col} ${def}`);
    console.log(`✓ Added applications.${col}`);
  }
}

// ── 2. Таблиця application_followups (заплановані тригери) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS application_followups (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    carrier_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,        -- '1hour'/'next_day'/'day_minus_1'
    scheduled_at TEXT NOT NULL,         -- коли спрацювати (ISO timestamp реального часу)
    fired INTEGER DEFAULT 0,            -- 0=ще не виконано, 1=виконано
    fired_at TEXT,
    cancelled INTEGER DEFAULT 0,        -- 0/1 — скасовано бо заявка вже надіслана
    paused_until TEXT,                  -- AI може відкласти (Q2) — якщо студент відповів
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
console.log('✓ Created table application_followups');

db.exec(`CREATE INDEX IF NOT EXISTS idx_followups_app ON application_followups(application_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON application_followups(scheduled_at, fired, cancelled)`);
console.log('✓ Indexes on application_followups');

console.log('\n✅ Migration v13 complete');
db.close();
