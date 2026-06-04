// scripts/migrate-v21.js — Деплой 24b: ПД-номери + таблиця штрафів/списань
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// ── 1. letters.pd_number — правильний номер ПД для кожного імпортного рейсу ──
const lettersInfo = db.prepare("PRAGMA table_info(letters)").all().map(c => c.name);
if (!lettersInfo.includes('pd_number')) {
  db.exec("ALTER TABLE letters ADD COLUMN pd_number TEXT");
  console.log('✓ Added column letters.pd_number');
} else {
  console.log('• letters.pd_number already exists');
}

// Генерація номерів: формат 26UA<митниця6><номер6>U1
// Тільки для імпортних рейсів (напрямок з letters_v2, fallback по dirs)
const CUSTOMS_POOL = [100000, 204000, 206000, 209000, 305000, 408000, 500000];

function genPdNumber() {
  const customs = CUSTOMS_POOL[Math.floor(Math.random() * CUSTOMS_POOL.length)];
  const num = String(Math.floor(100000 + Math.random() * 900000)); // 6 цифр
  return `26UA${customs}${num}U1`;
}

const letters = db.prepare('SELECT id, dirs, pd_number FROM letters').all();
let gen = 0, skipExisting = 0, skipExport = 0;

const getV2 = db.prepare('SELECT direction FROM letters_v2 WHERE letter_id=?');
const upd = db.prepare('UPDATE letters SET pd_number=? WHERE id=?');

const tx = db.transaction(() => {
  for (const l of letters) {
    if (l.pd_number) { skipExisting++; continue; }
    // імпорт: за letters_v2.direction, fallback — останній dir = UA
    let isImport = false;
    const v2 = getV2.get(l.id);
    if (v2) {
      isImport = v2.direction === 'імпорт';
    } else {
      try {
        const dirs = JSON.parse(l.dirs || '[]');
        isImport = dirs.length && dirs[dirs.length - 1] === 'UA';
      } catch (e) {}
    }
    if (!isImport) { skipExport++; continue; }
    upd.run(genPdNumber(), l.id);
    gen++;
  }
});
tx();
console.log(`✓ pd_number: згенеровано ${gen}, вже були ${skipExisting}, експорт (пропущено) ${skipExport}`);

// ── 2. Таблиця order_charges — штрафи/списання ──
db.exec(`
  CREATE TABLE IF NOT EXISTS order_charges (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    letter_id    TEXT NOT NULL,
    type         TEXT NOT NULL,            -- 'carrier_refusal_fine' | ...
    amount       REAL NOT NULL,            -- € (додатнє = списання)
    reason       TEXT,
    carrier_name TEXT,
    acknowledged INTEGER DEFAULT 0,        -- 1 після модалки "ОК"
    created_at   TEXT DEFAULT (datetime('now'))
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_charges_session ON order_charges(session_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_charges_letter ON order_charges(letter_id)`);
console.log('✓ Created table order_charges');

console.log('\n✅ Migration v21 complete');
db.close();
