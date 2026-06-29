// migrate-v30.js — хвилі листів per-assignment (не глобально на letters)
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

function buildWavePlan(n) {
  if (n === 8) {
    return [
      { day: 1, half: 1 }, { day: 1, half: 1 }, { day: 1, half: 1 }, { day: 1, half: 1 },
      { day: 2, half: 1 }, { day: 2, half: 1 },
      { day: 2, half: 2 }, { day: 2, half: 2 },
    ];
  }
  const d1 = Math.ceil(n * 0.5);
  const d2m = Math.ceil((n - d1) / 2);
  const d2a = n - d1 - d2m;
  const plan = [];
  for (let i = 0; i < d1; i++) plan.push({ day: 1, half: 1 });
  for (let i = 0; i < d2m; i++) plan.push({ day: 2, half: 1 });
  for (let i = 0; i < d2a; i++) plan.push({ day: 2, half: 2 });
  return plan;
}

if (!hasColumn('assignments', 'letter_waves')) {
  db.exec('ALTER TABLE assignments ADD COLUMN letter_waves TEXT');
  console.log('✓ assignments.letter_waves');
}

const assignments = db.prepare('SELECT id, letter_ids, letter_waves FROM assignments').all();
const upd = db.prepare('UPDATE assignments SET letter_waves=? WHERE id=?');
let backfilled = 0;

for (const a of assignments) {
  if (a.letter_waves) continue;
  let ids = [];
  try { ids = JSON.parse(a.letter_ids || '[]'); } catch (e) { ids = []; }
  if (!ids.length) continue;
  const plan = buildWavePlan(ids.length);
  const waves = {};
  ids.forEach((id, i) => {
    waves[id] = plan[i] || { day: 1, half: 1 };
  });
  upd.run(JSON.stringify(waves), a.id);
  backfilled++;
}

console.log(`✓ backfill letter_waves: ${backfilled} assignment(s)`);
console.log('\n✅ Migration v30 complete');
db.close();
