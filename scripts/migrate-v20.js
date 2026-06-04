// scripts/migrate-v20.js — Деплой 25: окрема таблиця letters_v2 (навчальні параметри)
// Прив'язка 1-до-1 до letters через letter_id. Не чіпає існуючі 120 листів.
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS letters_v2 (
    letter_id            TEXT PRIMARY KEY,   -- FK → letters.id
    seq                  INTEGER,            -- порядковий номер рейсу (для контролю)
    rate_basis           TEXT,               -- 'завантаження' / 'розвантаження'
    data_required        TEXT,               -- колонка 7 «Дані» з ODS (текст для листа)
    data_alternative     TEXT,               -- колонка 9 (рідко)
    hidden_task          TEXT,               -- колонка 10 (шпаргалка AI + критерій оцінки)
    vehicle_required     TEXT,               -- колонка 8 — точний тип ТЗ
    vehicle_alternative  TEXT,               -- колонка 9 — альтернатива (текст)
    freight_ref          INTEGER,            -- колонка 11 — орієнтир €
    incoterms            TEXT,               -- колонка 12
    difficulty_v2        TEXT,               -- колонка 13
    border_short         TEXT,               -- колонка 2
    total_km             INTEGER,            -- колонка 3
    km_before_border     INTEGER,            -- колонка 4
    km_after_border      INTEGER,            -- колонка 5
    direction            TEXT                -- 'імпорт' / 'експорт'
  )
`);
console.log('✓ Created table letters_v2');

db.exec(`CREATE INDEX IF NOT EXISTS idx_lettersv2_dir ON letters_v2(direction)`);
console.log('✓ Index on letters_v2');

console.log('\n✅ Migration v20 complete');
db.close();
