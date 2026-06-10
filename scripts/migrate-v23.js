// scripts/migrate-v23.js — №1: проставляємо реалістичну вагу рейсам де її не було
// (AI вигадував вагу з кількості палет — напр. "29 палет" → "29 тон"). Затверджено.
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

// Маршрут (фрагмент load→unload) → вага в тоннах. Зіставляємо за містами.
const WEIGHTS = [
  { from: 'Дрогобич',   to: 'Авейру',     t: 18 }, // ковбасні, 27 пал
  { from: 'Оснабрюк',   to: 'Костопіль',  t: 20 }, // кондитерські, 54 пал допельшток
  { from: 'Канів',      to: 'Гетеборг',   t: 19 }, // сир/мʼясо, 28 пал
  { from: 'Ейндховен',  to: 'Ужгород',    t: 8  }, // тюльпани, 58 пал (легкі)
  { from: 'Росток',     to: 'Городок',    t: 6  }, // запчастини, 9 пал (довантаження)
  { from: 'Чернігів',   to: 'Флоренція',  t: 12 }, // пластівці, 33 пал (легкі)
  { from: 'Ескішехір',  to: 'Кривий Ріг', t: 22 }, // банани, 29 пал (НЕ 29т)
];

// Знаходимо letter_id за містами (load_address / unload_address містять місто)
const letters = db.prepare('SELECT id, load_address, unload_address FROM letters').all();

function findLetter(from, to) {
  return letters.find(l =>
    (l.load_address || '').includes(from) && (l.unload_address || '').includes(to)
  );
}

let updated = 0, notFound = 0;
const updV2 = db.prepare('UPDATE letters_v2 SET data_required = data_required || ? WHERE letter_id = ? AND data_required NOT LIKE ?');

const tx = db.transaction(() => {
  for (const w of WEIGHTS) {
    const letter = findLetter(w.from, w.to);
    if (!letter) { console.log(`  ✗ не знайдено: ${w.from} → ${w.to}`); notFound++; continue; }
    // Додаємо вагу в кінець data_required (якщо там ще нема "т")
    const suffix = ` Вага вантажу: ${w.t}т.`;
    const res = updV2.run(suffix, letter.id, '%Вага вантажу:%');
    if (res.changes > 0) { updated++; console.log(`  ✓ ${w.from} → ${w.to}: +${w.t}т`); }
    else console.log(`  • ${w.from} → ${w.to}: вже має вагу, пропущено`);
  }
});
tx();

console.log(`\n✓ Оновлено ${updated} рейсів, не знайдено ${notFound}`);
console.log('✅ Migration v23 complete');
db.close();
