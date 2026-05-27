// migrate-v14.js — Деплой 13: інциденти, state machine рейсу, resume_points
// Запуск: node scripts/migrate-v14.js
// ВАЖЛИВО: перед запуском зробити бекап data/simulator.db !

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'simulator.db');
console.log('[migrate-v14] Database:', dbPath);
const db = new Database(dbPath);

// Helper для безпечного додавання колонки
function addColumn(table, name, definition) {
  try {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name);
    if (exists) {
      console.log(`  • ${table}.${name} — вже є, пропускаю`);
      return;
    }
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    console.log(`  ✓ Додано ${table}.${name}`);
  } catch (e) {
    console.error(`  ✗ ${table}.${name}: ${e.message}`);
  }
}

console.log('\n[1/4] scenario_id у listers...');
addColumn('letters', 'scenario_id', 'INTEGER');

console.log('\n[2/4] State machine у order_progress...');
addColumn('order_progress', 'state', 'TEXT DEFAULT "new"');
addColumn('order_progress', 'scenario_id', 'INTEGER');
addColumn('order_progress', 'loaded_at', 'TEXT');
addColumn('order_progress', 'at_border_at', 'TEXT');
addColumn('order_progress', 'at_customs_at', 'TEXT');
addColumn('order_progress', 'delivered_at', 'TEXT');
addColumn('order_progress', 'pd_requested_at', 'TEXT');
addColumn('order_progress', 'pd_sent_at', 'TEXT');
addColumn('order_progress', 'student_informed_client', 'INTEGER DEFAULT 0');
addColumn('order_progress', 'student_informed_carrier', 'INTEGER DEFAULT 0');

console.log('\n[3/4] Таблиця incidents...');
db.prepare(`
  CREATE TABLE IF NOT EXISTS incidents (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    student_id      TEXT NOT NULL,
    letter_id       TEXT NOT NULL,
    application_id  TEXT,
    scenario_id     INTEGER,
    type            TEXT NOT NULL,
    state           TEXT DEFAULT 'pending',
    scheduled_at    TEXT NOT NULL,
    fired_at        TEXT,
    payload_json    TEXT,
    margin_delta    REAL DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_incidents_session ON incidents(session_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_incidents_letter ON incidents(letter_id)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_incidents_state_time ON incidents(state, scheduled_at)`).run();
console.log('  ✓ Таблиця incidents створена');

console.log('\n[4/4] Таблиця resume_points...');
db.prepare(`
  CREATE TABLE IF NOT EXISTS resume_points (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    student_id      TEXT NOT NULL,
    letter_id       TEXT,
    application_id  TEXT,
    type            TEXT NOT NULL,
    impact          INTEGER NOT NULL,
    context_json    TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_resume_session ON resume_points(session_id)`).run();
console.log('  ✓ Таблиця resume_points створена');

db.close();
console.log('\n[migrate-v14] ✓ Готово.\n');
