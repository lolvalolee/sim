// migrate-v18.js — Деплой 24a: прапорець паузи сесії + час паузи
// Запуск: node scripts/migrate-v18.js

const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'simulator.db');
console.log('[migrate-v18] Database:', dbPath);
const db = new Database(dbPath);

function addColumn(table, name, definition) {
  try {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name);
    if (exists) { console.log(`  • ${table}.${name} — вже є`); return; }
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    console.log(`  ✓ ${table}.${name}`);
  } catch (e) { console.error(`  ✗ ${table}.${name}: ${e.message}`); }
}

console.log('\n[1/1] Пауза сесії...');
addColumn('sessions', 'paused', 'INTEGER NOT NULL DEFAULT 0');
addColumn('sessions', 'paused_at', 'TEXT');

console.log('\n[migrate-v18] ✓ Готово.\n');
db.close();
