// scripts/migrate-v7.js — база замовників + поля адрес для заявок
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// 1. Таблиця clients — повні реквізити замовників
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,             -- "Andreas Müller Logistik GmbH"
    person TEXT,                       -- "Andreas Müller"
    country TEXT NOT NULL,             -- 'DE'
    city TEXT,                         -- "Frankfurt am Main"
    address TEXT,                      -- "Bahnhofstraße 12, 60329"
    vat_id TEXT,                       -- "DE 287 446 591"
    phone TEXT,                        -- "+49 69 4587 1124"
    email TEXT,                        -- "a.mueller@logistik-gmbh.de"
    business_type TEXT,                -- 'shipper' | 'forwarder' | 'manufacturer'
    notes TEXT,                        -- '' or freeform
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
console.log('✓ Created table clients');

db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_country ON clients(country)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company)`);
console.log('✓ Indexes on clients');

// 2. Нові поля у letters для заявки
const lettersInfo = db.prepare("PRAGMA table_info(letters)").all().map(c => c.name);

const newLetterCols = [
  ['client_id',           'TEXT'],     // FK до clients (опціонально, для нових seed)
  ['load_address',        'TEXT'],     // повна адреса завантаження
  ['load_contact_name',   'TEXT'],     // ПІБ контактної особи
  ['load_contact_phone',  'TEXT'],     // телефон
  ['unload_address',      'TEXT'],     // повна адреса розвантаження
  ['unload_contact_name', 'TEXT'],
  ['unload_contact_phone','TEXT'],
  ['customs_out_address', 'TEXT'],     // митниця в країні відправлення (або "на місці")
  ['customs_in_address',  'TEXT'],     // митниця в країні призначення
  ['cargo_weight_kg',     'REAL'],     // вага якщо відома
  ['cargo_volume_m3',     'REAL'],     // об'єм
  ['cargo_pallets',       'INTEGER'],  // кількість палет
  ['cargo_description',   'TEXT'],     // опис вантажу
];

for (const [col, def] of newLetterCols) {
  if (!lettersInfo.includes(col)) {
    db.exec(`ALTER TABLE letters ADD COLUMN ${col} ${def}`);
    console.log(`✓ Added column letters.${col}`);
  }
}

console.log('\n✅ Migration v7 complete');
db.close();
