// scripts/migrate-v10.js — стан рейсу і журнал подій
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// 1. Колонка order_progress.state (формальний статус рейсу)
const opInfo = db.prepare("PRAGMA table_info(order_progress)").all().map(c => c.name);

const newCols = [
  ['state',                   "TEXT NOT NULL DEFAULT 'new'"],
  // Що зафіксовано з замовником
  ['client_agreed_price',     'REAL'],
  ['client_agreed_date',      'TEXT'],
  ['client_agreed_at',        'TEXT'],
  // Що зафіксовано з перевізником (carrier_freight уже є, але переіменуємо логічно)
  ['carrier_agreed_price',    'REAL'],
  ['carrier_agreed_date',     'TEXT'],
  ['carrier_agreed_at',       'TEXT'],
  // Чи був перетрейд (передомовлення)
  ['renegotiated_count',      'INTEGER DEFAULT 0'],
  ['prev_carrier_id',         'TEXT'],
];

for (const [col, def] of newCols) {
  if (!opInfo.includes(col)) {
    db.exec(`ALTER TABLE order_progress ADD COLUMN ${col} ${def}`);
    console.log(`✓ Added column order_progress.${col}`);
  }
}

// 2. Таблиця order_events — журнал ключових подій
db.exec(`
  CREATE TABLE IF NOT EXISTS order_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    letter_id TEXT NOT NULL,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
console.log('✓ Created table order_events');

db.exec(`CREATE INDEX IF NOT EXISTS idx_events_session ON order_events(session_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_events_letter ON order_events(letter_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_events_type ON order_events(type)`);
console.log('✓ Indexes on order_events');

// 3. Backfill існуючим order_progress статус на основі поточних полів
const existing = db.prepare(`
  SELECT id, application_sent, carrier_id, client_freight, carrier_freight FROM order_progress WHERE state = 'new'
`).all();

let backfilled = 0;
for (const op of existing) {
  let newState = 'new';
  if (op.application_sent && op.carrier_id) newState = 'closed';
  else if (op.application_sent) newState = 'client_agreed';
  else if (op.carrier_id && op.carrier_freight) newState = 'carrier_agreed';
  else if (op.client_freight) newState = 'in_progress';

  if (newState !== 'new') {
    db.prepare('UPDATE order_progress SET state=? WHERE id=?').run(newState, op.id);
    backfilled++;
  }
}
console.log(`✓ Backfilled ${backfilled} order_progress with state`);

console.log('\n✅ Migration v10 complete');
db.close();
