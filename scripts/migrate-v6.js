// scripts/migrate-v6.js — таблиця для AI-резюме студентів
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// Створюємо таблицю student_summaries якщо ще нема
db.exec(`
  CREATE TABLE IF NOT EXISTS student_summaries (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    ai_text TEXT,
    lecturer_note TEXT DEFAULT '',
    metrics_json TEXT,
    generated_at TEXT,
    note_updated_at TEXT,
    sent_to_student INTEGER DEFAULT 0,
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(student_id)
  )
`);
console.log('✓ Created table student_summaries (or already exists)');

// Індекси для швидкого пошуку
db.exec(`CREATE INDEX IF NOT EXISTS idx_summaries_student ON student_summaries(student_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_summaries_group ON student_summaries(group_id)`);
console.log('✓ Indexes created');

console.log('\n✅ Migration v6 complete');
db.close();
