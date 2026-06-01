// migrate-v17.js — Деплой 23: повні реквізити замовників+перевізників, номери договорів
// Запуск: node scripts/migrate-v17.js

const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'simulator.db');
console.log('[migrate-v17] Database:', dbPath);
const db = new Database(dbPath);

function addColumn(table, name, definition) {
  try {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name);
    if (exists) { console.log(`  • ${table}.${name} — вже є`); return; }
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    console.log(`  ✓ ${table}.${name}`);
  } catch (e) { console.error(`  ✗ ${table}.${name}: ${e.message}`); }
}

console.log('\n[1/3] Реквізити замовників у letters...');
addColumn('letters', 'client_address', 'TEXT');
addColumn('letters', 'client_iban', 'TEXT');
addColumn('letters', 'client_bank', 'TEXT');
addColumn('letters', 'client_edrpou', 'TEXT');
addColumn('letters', 'client_director', 'TEXT');
addColumn('letters', 'client_contract_no', 'TEXT'); // постійний номер за замовником

console.log('\n[2/3] Реквізити перевізників у carriers...');
addColumn('carriers', 'edrpou', 'TEXT');
addColumn('carriers', 'address', 'TEXT');

console.log('\n[3/3] Документи у order_progress...');
addColumn('order_progress', 'spravka_json', 'TEXT');   // ввід студента + перевірка
addColumn('order_progress', 'rakhunok_json', 'TEXT');  // ввід студента + перевірка
addColumn('order_progress', 'akt_json', 'TEXT');

console.log('\n[migrate-v17] ✓ Готово.\n');
db.close();
