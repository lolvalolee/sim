// scripts/migrate-v3.js — додає поля старту симуляції в groups
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

// Add columns to groups if not exist
const groupsInfo = db.prepare("PRAGMA table_info(groups)").all();
const groupCols = groupsInfo.map(c => c.name);

const newGroupCols = [
  ["start_date", "TEXT"],          // DD.MM.YYYY
  ["started_at", "TEXT"],          // datetime або NULL
  ["mode",       "TEXT DEFAULT 'real'"], // real | fast | mixed (на майбутнє)
];

for (const [col, def] of newGroupCols) {
  if (!groupCols.includes(col)) {
    db.exec(`ALTER TABLE groups ADD COLUMN ${col} ${def}`);
    console.log(`✓ Added column groups.${col}`);
  }
}

// Backfill для існуючих груп: start_date = DATE(created_at), started_at = created_at
// Це робить старі групи відразу "стартованими" з реальною датою створення.
// Лектор зможе скинути старт через кнопку "🔄 Скинути старт" якщо треба тестувати.
const toBackfill = db.prepare(`
  SELECT id, created_at FROM groups WHERE start_date IS NULL
`).all();

if (toBackfill.length) {
  const upd = db.prepare(`UPDATE groups SET start_date=?, started_at=? WHERE id=?`);
  for (const g of toBackfill) {
    // created_at у форматі 'YYYY-MM-DD HH:MM:SS' → конвертуємо у DD.MM.YYYY
    const d = new Date(g.created_at.replace(' ', 'T') + 'Z');
    const dd = String(d.getUTCDate()).padStart(2,'0');
    const mm = String(d.getUTCMonth()+1).padStart(2,'0');
    const yyyy = d.getUTCFullYear();
    const startDate = `${dd}.${mm}.${yyyy}`;
    upd.run(startDate, g.created_at, g.id);
  }
  console.log(`✓ Backfilled ${toBackfill.length} existing group(s) with start_date+started_at`);
}

console.log('\n✅ Migration v3 complete');
db.close();
