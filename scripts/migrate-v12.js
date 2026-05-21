// scripts/migrate-v12.js — нові поля для якісніших листів
const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

const lettersInfo = db.prepare("PRAGMA table_info(letters)").all().map(c => c.name);

// Альтернативні типи ТЗ (JSON масив)
if (!lettersInfo.includes('vehicle_alternatives')) {
  db.exec("ALTER TABLE letters ADD COLUMN vehicle_alternatives TEXT");
  console.log('✓ Added letters.vehicle_alternatives');
}

// Приховані дані (JSON об'єкт: {"палети": "120х80х180, 30 шт", "температура": "+4/+7"})
if (!lettersInfo.includes('hidden_data')) {
  db.exec("ALTER TABLE letters ADD COLUMN hidden_data TEXT");
  console.log('✓ Added letters.hidden_data');
}

// Завдання-підказка для AI (інструкція що робити)
if (!lettersInfo.includes('task_hint')) {
  db.exec("ALTER TABLE letters ADD COLUMN task_hint TEXT");
  console.log('✓ Added letters.task_hint');
}

// Складність (ЛЕГКЕ/СЕРЕДНЄ/ВАЖКЕ/СУПЕР-ВАЖКЕ)
if (!lettersInfo.includes('difficulty_level')) {
  db.exec("ALTER TABLE letters ADD COLUMN difficulty_level TEXT");
  console.log('✓ Added letters.difficulty_level');
}

// Distance km для рейсу (з таблиці)
if (!lettersInfo.includes('distance_km')) {
  db.exec("ALTER TABLE letters ADD COLUMN distance_km INTEGER");
  console.log('✓ Added letters.distance_km');
}

// Поле в groups — складність (1=легше, 2=зі складними; default 1)
const groupsInfo = db.prepare("PRAGMA table_info(groups)").all().map(c => c.name);
if (!groupsInfo.includes('difficulty')) {
  db.exec("ALTER TABLE groups ADD COLUMN difficulty INTEGER NOT NULL DEFAULT 1");
  console.log('✓ Added groups.difficulty');
}

console.log('\n✅ Migration v12 complete');
db.close();
