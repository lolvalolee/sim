// migrate-v27.js — серверний сим-час (sim_clock_at, heartbeat, appear_half)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
const DEFAULT_RATES = [41.5, 41.65, 41.8, 41.7, 41.9, 42.05, 41.95, 42.1];

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

const tx = db.transaction(() => {
  if (!hasColumn('sessions', 'sim_clock_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN sim_clock_at TEXT');
    console.log('✓ sessions.sim_clock_at');
  }
  if (!hasColumn('sessions', 'last_heartbeat_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_heartbeat_at TEXT');
    console.log('✓ sessions.last_heartbeat_at');
  }
  if (!hasColumn('sessions', 'auto_paused')) {
    db.exec('ALTER TABLE sessions ADD COLUMN auto_paused INTEGER NOT NULL DEFAULT 0');
    console.log('✓ sessions.auto_paused');
  }
  if (!hasColumn('letters', 'appear_half')) {
    db.exec('ALTER TABLE letters ADD COLUMN appear_half INTEGER NOT NULL DEFAULT 1');
    console.log('✓ letters.appear_half (1=ранок, 2=друга половина дня)');
  }
  // Ініціалізація годинника для існуючих сесій
  db.exec(`UPDATE sessions SET sim_clock_at=datetime('now'), last_heartbeat_at=datetime('now')
    WHERE sim_clock_at IS NULL OR sim_clock_at=''`);

  // Нормалізуємо курси до 8 сим-днів для існуючих груп/сесій
  const normalizeRates = (jsonText) => {
    try {
      const arr = JSON.parse(jsonText || '[]');
      if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_RATES.slice();
      const out = arr.slice(0, 8).map(v => Number(v) || 0).filter(v => v > 0);
      while (out.length < 8) out.push(DEFAULT_RATES[out.length]);
      return out;
    } catch (_) {
      return DEFAULT_RATES.slice();
    }
  };

  const updGroupRates = db.prepare('UPDATE groups SET rates=? WHERE id=?');
  for (const row of db.prepare('SELECT id, rates FROM groups').all()) {
    updGroupRates.run(JSON.stringify(normalizeRates(row.rates)), row.id);
  }

  const updSessionRates = db.prepare('UPDATE sessions SET rates=? WHERE id=?');
  for (const row of db.prepare('SELECT id, rates FROM sessions').all()) {
    updSessionRates.run(JSON.stringify(normalizeRates(row.rates)), row.id);
  }
});
tx();

console.log('\n✅ Migration v27 complete');
db.close();
