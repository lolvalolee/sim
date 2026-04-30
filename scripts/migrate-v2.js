// scripts/migrate-v2.js — додає нові таблиці і колонки
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// Add new columns to letters if not exist
const lettersInfo = db.prepare("PRAGMA table_info(letters)").all();
const letterCols = lettersInfo.map(c=>c.name);
const newLetterCols = [
  ["difficulty","TEXT DEFAULT 'СЕРЕДНЄ'"],
  ["task_hint","TEXT"],
  ["has_photo","INTEGER DEFAULT 0"],
  ["photo_file","TEXT"],
  ["contract_number","TEXT"],
  ["per_tonne_rate","REAL"],
];
for(const [col,def] of newLetterCols){
  if(!letterCols.includes(col)){
    db.exec(`ALTER TABLE letters ADD COLUMN ${col} ${def}`);
    console.log(`✓ Added column letters.${col}`);
  }
}

// Carriers table
db.exec(`
  CREATE TABLE IF NOT EXISTS carriers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    person TEXT NOT NULL,
    phone TEXT,
    dirs TEXT NOT NULL DEFAULT '["UA","PL"]',
    vehicle_types TEXT NOT NULL DEFAULT '["Тент"]',
    reliability REAL DEFAULT 0.85,
    availability REAL DEFAULT 0.60,
    personality TEXT DEFAULT 'tough',
    nationality TEXT DEFAULT 'UA',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
console.log('✓ carriers table ready');

// Exchange board (біржа)
db.exec(`
  CREATE TABLE IF NOT EXISTS cargo_board (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    student_id TEXT NOT NULL REFERENCES users(id),
    route TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    weight TEXT,
    volume TEXT,
    load_date TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active',
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
console.log('✓ cargo_board table ready');

// Student analysis
db.exec(`
  CREATE TABLE IF NOT EXISTS student_analysis (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    student_id TEXT NOT NULL REFERENCES users(id),
    lecturer_id TEXT REFERENCES users(id),
    carrier_analysis TEXT,
    client_analysis TEXT,
    docs_analysis TEXT,
    ai_summary TEXT,
    lecturer_summary TEXT,
    sent_to_student INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
console.log('✓ student_analysis table ready');

// Confirmations (підтвердження домовленостей)
db.exec(`
  CREATE TABLE IF NOT EXISTS confirmations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    letter_id TEXT,
    carrier_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('client','carrier')),
    freight REAL,
    load_date TEXT,
    confirmed_at TEXT DEFAULT (datetime('now'))
  )
`);
console.log('✓ confirmations table ready');

console.log('\n✅ Migration v2 complete');
db.close();
