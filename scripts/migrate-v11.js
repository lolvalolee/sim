// scripts/migrate-v11.js — таблиця заявок (applications)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    student_id TEXT NOT NULL,

    -- номер заявки (унікальний у межах студента)
    number_seq INTEGER NOT NULL,
    number_year INTEGER NOT NULL,

    -- зв'язки (необов'язкові — заявка може бути створена без підтверджень)
    letter_id TEXT,
    client_id TEXT,
    carrier_id TEXT,

    -- маршрут
    load_address TEXT,
    customs_out TEXT,
    customs_in TEXT,
    unload_address TEXT,
    border_crossing TEXT,

    -- вантаж
    cargo_description TEXT,
    cargo_weight REAL,
    cargo_volume REAL,
    adr_class TEXT,

    -- дати
    load_date TEXT,
    unload_date TEXT,

    -- транспорт
    vehicle_type TEXT,
    vehicle_requirements TEXT,
    truck_plate TEXT,
    trailer_plate TEXT,
    driver_name TEXT,
    driver_phone TEXT,

    -- фінанси (тільки EUR)
    client_freight REAL,
    carrier_freight REAL,
    reward REAL,

    -- додатково
    additional_info TEXT,

    -- статус
    status TEXT NOT NULL DEFAULT 'new',  -- 'new'/'in_transit'/'completed'/'cancelled'

    -- момент надсилання заявки перевізнику (NULL поки не надіслано)
    sent_to_carrier_at TEXT,

    -- доставка
    delivery_confirmed_at TEXT,

    -- журнал попереджень валідації (JSON масив)
    -- Структура: [{ field: 'client_freight', expected: 2700, actual: 2900, severity: 'warn' }]
    validation_warnings TEXT,

    -- timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

console.log('✓ Created table applications');

db.exec(`CREATE INDEX IF NOT EXISTS idx_app_session ON applications(session_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_app_student ON applications(student_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_app_letter ON applications(letter_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status)`);
console.log('✓ Indexes on applications');

console.log('\n✅ Migration v11 complete');
db.close();
