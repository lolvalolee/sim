// scripts/migrate-v8.js — поля для заявки від замовника (clientRequestVariant)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

const info = db.prepare("PRAGMA table_info(order_progress)").all().map(c => c.name);

const newCols = [
  ['application_sent',     'INTEGER DEFAULT 0'],          // 1 якщо заявка вже надіслана замовником
  ['application_data',     'TEXT'],                        // JSON з усіма полями заявки
  ['application_variant',  'TEXT'],                        // 'text' | 'attachment' | 'incomplete_text' | 'incomplete_attachment'
  ['application_missing',  'TEXT DEFAULT \'[]\''],         // JSON масив пропущених полів для incomplete
  ['application_sent_at',  'TEXT'],                        // datetime коли AI надіслав
  ['vehicle_data_sent',    'INTEGER DEFAULT 0'],           // 1 якщо студент надіслав авто+водія
  ['vehicle_asked_by_client','INTEGER DEFAULT 0'],         // 1 якщо замовник питав авто+водія до заявки
  ['vehicle_data',         'TEXT'],                        // JSON з даними ТЗ і водія {plate, driver_name, driver_phone}
  ['confirm_blocked',      'INTEGER DEFAULT 0'],           // 1 якщо вже підтверджено (для блокування кнопки)
];

for (const [col, def] of newCols) {
  if (!info.includes(col)) {
    db.exec(`ALTER TABLE order_progress ADD COLUMN ${col} ${def}`);
    console.log(`✓ Added column order_progress.${col}`);
  }
}

console.log('\n✅ Migration v8 complete');
db.close();
