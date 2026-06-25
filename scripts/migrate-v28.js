// migrate-v28.js — нормалізація load_day_offset / deliv_day_offset під 8 сим-днів
const Database = require('better-sqlite3');
require('dotenv').config();
const { normalizeLetterOffsets } = require('../server/utils/letter-offsets');

const db = new Database(process.env.DB_PATH || './data/simulator.db');

const letters = db.prepare('SELECT id, code, load_day_offset, deliv_day_offset FROM letters ORDER BY code').all();
const upd = db.prepare('UPDATE letters SET load_day_offset=?, deliv_day_offset=? WHERE id=?');

const tx = db.transaction(() => {
  let changed = 0;
  for (let i = 0; i < letters.length; i++) {
    const { load_day_offset, deliv_day_offset } = normalizeLetterOffsets(i);
    const l = letters[i];
    if (l.load_day_offset !== load_day_offset || l.deliv_day_offset !== deliv_day_offset) {
      upd.run(load_day_offset, deliv_day_offset, l.id);
      changed++;
    }
  }
  console.log(`✓ letters: ${changed}/${letters.length} оновлено (load +2…+4, deliv до +7)`);
});
tx();

console.log('\n✅ Migration v28 complete');
db.close();
