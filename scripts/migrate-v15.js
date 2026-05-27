// migrate-v15.js — Деплой 14: простої, торг, маржа
// Запуск: node scripts/migrate-v15.js

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'simulator.db');
console.log('[migrate-v15] Database:', dbPath);
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

console.log('\n[1/2] Розширення incidents для торгу простоями...');
// Кількість раундів переговорів (для авто-виклику модалки після 2 безуспішних)
addColumn('incidents', 'negotiation_round', 'INTEGER DEFAULT 0');
// Сума яку вимагає перевізник (€)
addColumn('incidents', 'demand_amount', 'REAL');
// Відповідь замовника (agreed / refused / null)
addColumn('incidents', 'client_decision', 'TEXT');
// Рішення студента (student_pays / client_pays / carrier_dropped / null)
addColumn('incidents', 'student_decision', 'TEXT');

console.log('\n[2/2] Розширення order_progress для маржі...');
// Скільки €€ пішло у простої (зменшує прибуток студента)
addColumn('order_progress', 'simple_paid_by_student', 'REAL DEFAULT 0');
// Скільки €€ пішло у простої від замовника (нейтрально для маржі)
addColumn('order_progress', 'simple_paid_by_client', 'REAL DEFAULT 0');

db.close();
console.log('\n[migrate-v15] ✓ Готово.\n');
