// scripts/migrate-v22.js — Деплой багфіксів: таблиця угод + налаштування паузи лектором
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// ── 1. session_deals — журнал підтверджених угод (джерело істини) ──
// Один рядок на (session, letter, role). role: 'client' | 'carrier'.
// Оновлюється при підтвердженні угоди; при заміні перевізника — перезаписується.
db.exec(`
  CREATE TABLE IF NOT EXISTS session_deals (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    letter_id       TEXT NOT NULL,
    role            TEXT NOT NULL,          -- 'client' | 'carrier'
    counterparty_id TEXT,                   -- client_id або carrier_id
    counterparty_name TEXT,
    agreed_price    REAL,                   -- погоджена ціна €
    load_date       TEXT,                   -- дата завантаження ДД.ММ.РРРР
    status          TEXT DEFAULT 'active',  -- 'active' | 'cancelled'
    agreed_at       TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, letter_id, role)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_deals_session ON session_deals(session_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_deals_letter ON session_deals(session_id, letter_id)`);
console.log('✓ Created table session_deals');

// ── 2. groups.idle_pause_min — інтервал авто-паузи (хв реального часу) ──
// NULL = без авто-паузи. За замовчуванням лишаємо NULL (паузу прибрано).
const groupsInfo = db.prepare("PRAGMA table_info(groups)").all().map(c => c.name);
if (!groupsInfo.includes('idle_pause_min')) {
  db.exec("ALTER TABLE groups ADD COLUMN idle_pause_min INTEGER DEFAULT NULL");
  console.log('✓ Added column groups.idle_pause_min (NULL = без паузи)');
} else {
  console.log('• groups.idle_pause_min already exists');
}

// ── 3. Бекфіл session_deals з наявних order_progress (щоб не втратити поточні угоди) ──
let backfilled = 0;
try {
  const ops = db.prepare(`
    SELECT op.session_id, op.letter_id, op.carrier_id,
           op.client_agreed_price, op.client_agreed_date,
           op.carrier_agreed_price, op.carrier_agreed_date
    FROM order_progress op
    WHERE op.client_agreed_price IS NOT NULL OR op.carrier_agreed_price IS NOT NULL
  `).all();
  const { v4: uuidv4 } = require('uuid');
  const ins = db.prepare(`
    INSERT OR IGNORE INTO session_deals
      (id, session_id, letter_id, role, counterparty_id, agreed_price, load_date, status)
    VALUES (?,?,?,?,?,?,?, 'active')
  `);
  const tx = db.transaction(() => {
    for (const op of ops) {
      if (op.client_agreed_price != null) {
        ins.run(uuidv4(), op.session_id, op.letter_id, 'client', null, op.client_agreed_price, op.client_agreed_date);
        backfilled++;
      }
      if (op.carrier_agreed_price != null) {
        ins.run(uuidv4(), op.session_id, op.letter_id, 'carrier', op.carrier_id, op.carrier_agreed_price, op.carrier_agreed_date);
        backfilled++;
      }
    }
  });
  tx();
} catch (e) { console.log('• backfill пропущено:', e.message); }
console.log(`✓ Backfilled ${backfilled} угод у session_deals`);

console.log('\n✅ Migration v22 complete');
db.close();
