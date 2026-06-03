// scripts/migrate-v19.js — Деплой 25c: документи v2 (версії + єдиний флоу)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// ── 1. Таблиця order_documents — версії документів і заявок ──
// doc_type: 'application' | 'spravka' | 'rakhunok' | 'akt'
//   - application: окремий запис на кожну заявку (різні carrier_id), version=1
//   - spravka/rakhunok/akt: версії 1,2,3... на один рейс
// status: 'sent' (надіслано, чекає перевірки) | 'accepted' | 'error'
// check_due_at: ISO час коли cron перевіряє (1–20 сим-хв після надсилання)
db.exec(`
  CREATE TABLE IF NOT EXISTS order_documents (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL,
    letter_id     TEXT NOT NULL,
    application_id TEXT,
    doc_type      TEXT NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    carrier_id    TEXT,
    payload_json  TEXT,
    html          TEXT,
    status        TEXT NOT NULL DEFAULT 'sent',
    errors_json   TEXT DEFAULT '[]',
    check_due_at  TEXT,
    checked_at    TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  )
`);
console.log('✓ Created table order_documents');

db.exec(`CREATE INDEX IF NOT EXISTS idx_orderdocs_session ON order_documents(session_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_orderdocs_letter ON order_documents(letter_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_orderdocs_due ON order_documents(status, check_due_at)`);
console.log('✓ Indexes on order_documents');

// ── 2. Курси на заявку (персист + редагування) ──
const appsInfo = db.prepare("PRAGMA table_info(applications)").all().map(c => c.name);
for (const [col, def] of [['rate_client', 'TEXT'], ['rate_carrier', 'TEXT']]) {
  if (!appsInfo.includes(col)) {
    db.exec(`ALTER TABLE applications ADD COLUMN ${col} ${def}`);
    console.log(`✓ Added column applications.${col}`);
  } else {
    console.log(`• applications.${col} already exists`);
  }
}

console.log('\n✅ Migration v19 complete');
db.close();
