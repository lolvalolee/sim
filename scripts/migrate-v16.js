// migrate-v16.js — Деплой 19: відстані до/після кордону + поля часу
// Запуск: node scripts/migrate-v16.js

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'simulator.db');
console.log('[migrate-v16] Database:', dbPath);
const db = new Database(dbPath);

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

console.log('\n[1/3] Відстані до/після кордону у letters...');
addColumn('letters', 'dist_to_border', 'INTEGER');
addColumn('letters', 'dist_after_border', 'INTEGER');
addColumn('letters', 'border_name', 'TEXT');
addColumn('letters', 'appear_day', 'INTEGER DEFAULT 1');

console.log('\n[2/3] Поля часу/паузи у sessions...');
addColumn('sessions', 'paused', 'INTEGER DEFAULT 0');
addColumn('sessions', 'paused_at', 'TEXT');
addColumn('sessions', 'rates_json', 'TEXT'); // згенеровані курси по днях

console.log('\n[3/3] Готово зі схемою.');

db.close();
console.log('\n[migrate-v16] ✓ Готово.\n');
