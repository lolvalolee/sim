// scripts/rename-duplicate-carriers.js
// Знаходить дублі і схожі назви перевізників, переназиває їх (НЕ видаляє).
// Зберігає всі ID — не ламає посилання.

const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

// Нормалізація назви — для порівняння
function normalize(name) {
  return name.toLowerCase()
    .replace(/тов|фоп|тзов|пп|sp\.\s*z\s*o\.\s*o\.?|gmbh|sa|s\.a\.|s\.r\.l\.|ltd\.?|b\.v\.|inc\.?|llc/gi, '')
    .replace(/«|»|"|'/g, '')
    .replace(/[^\w\u0400-\u04FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const carriers = db.prepare("SELECT id, name FROM carriers WHERE active=1 ORDER BY name").all();
console.log(`Всього перевізників: ${carriers.length}`);

// ── 1. Знаходимо групи дублів за нормалізованим іменем ──
const groups = {};
for (const c of carriers) {
  const norm = normalize(c.name);
  if (!groups[norm]) groups[norm] = [];
  groups[norm].push(c);
}

const duplicateGroups = Object.entries(groups).filter(([_, arr]) => arr.length > 1);
console.log(`\nЗнайдено ${duplicateGroups.length} груп дублів:`);

// ── 2. Генератор унікальних суфіксів ──
const suffixes = [
  'Експрес', 'Логістик', 'Карго', 'Транс-Плюс', 'Європа', 'Захід', 'Схід',
  'Південь', 'Північ', 'Спецтранс', 'Авто', 'Прайм', 'Профі',
  'Лідер', 'Голд', 'Преміум', 'Класік', 'Сервіс', 'Партнер', 'Альянс',
  'Регіон', 'Континент', 'Маршрут', 'Швидкість', 'Надійність', 'Якість',
];

const europeanSuffixes = [
  'Express', 'Logistics', 'Cargo', 'Trans Plus', 'Europe', 'West', 'East',
  'South', 'North', 'Spec-Trans', 'Auto', 'Prime', 'Pro',
  'Leader', 'Gold', 'Premium', 'Classic', 'Service', 'Partner', 'Alliance',
  'Region', 'Continent', 'Route', 'Speed', 'Reliable', 'Quality',
];

// ── 3. Переназиваємо ──
let renamedCount = 0;
const report = [];

for (const [norm, group] of duplicateGroups) {
  // Перший в групі залишається без зміни
  const original = group[0];

  // Решта — переназиваємо
  const usedSuffixes = new Set();
  for (let i = 1; i < group.length; i++) {
    const c = group[i];
    const isUkrainian = /[\u0400-\u04FF]/.test(c.name);

    // Шукаємо новий унікальний суфікс
    let newName = null;
    const suffixPool = isUkrainian ? suffixes : europeanSuffixes;

    for (const suf of suffixPool) {
      if (usedSuffixes.has(suf)) continue;

      // Будуємо нову назву
      // Якщо є «ТОВ «X»» — замінюємо на «ТОВ «X-Експрес»»
      const m = c.name.match(/^(.*?)(«[^»]+»|"[^"]+")(.*)$/);
      let candidate;
      if (m) {
        const innerMatch = m[2].match(/[«"]([^»"]+)[»"]/);
        const inner = innerMatch ? innerMatch[1] : '';
        const quote = m[2].startsWith('«') ? ['«','»'] : ['"','"'];
        candidate = `${m[1]}${quote[0]}${inner}-${suf}${quote[1]}${m[3]}`;
      } else {
        candidate = `${c.name} ${suf}`;
      }

      // Перевіряємо чи цієї назви ще нема в БД
      const exists = db.prepare("SELECT id FROM carriers WHERE name=? AND id != ?").get(candidate, c.id);
      if (!exists) {
        newName = candidate;
        usedSuffixes.add(suf);
        break;
      }
    }

    if (!newName) {
      // Fallback - просто додаємо номер
      newName = `${c.name} (${i + 1})`;
    }

    db.prepare("UPDATE carriers SET name=? WHERE id=?").run(newName, c.id);
    report.push({
      old: c.name,
      new: newName,
      group: norm.slice(0, 40),
    });
    renamedCount++;
  }
}

console.log(`\n✓ Переназвано ${renamedCount} перевізників`);
console.log('\n📋 Звіт перейменувань (перші 30):');
for (const r of report.slice(0, 30)) {
  console.log(`  "${r.old}"`);
  console.log(`    → "${r.new}"`);
}
if (report.length > 30) {
  console.log(`  ... ще ${report.length - 30} перейменувань`);
}

// ── 4. Шукаємо схожі (не точні дублі) ──
console.log('\n🔍 Шукаю схожі назви (Левенштейн < 4):');

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array(m+1).fill(null).map(() => Array(n+1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

// Перечитуємо всіх перевізників після переназивань
const carriersAfter = db.prepare("SELECT id, name FROM carriers WHERE active=1 ORDER BY name").all();
const similar = [];
for (let i = 0; i < carriersAfter.length; i++) {
  for (let j = i + 1; j < carriersAfter.length; j++) {
    const a = normalize(carriersAfter[i].name);
    const b = normalize(carriersAfter[j].name);
    if (Math.abs(a.length - b.length) > 5) continue;
    const d = levenshtein(a, b);
    if (d > 0 && d < 4 && a.length > 6) {
      similar.push([carriersAfter[i].name, carriersAfter[j].name, d]);
    }
  }
}

if (similar.length > 0) {
  console.log(`Знайдено ${similar.length} пар схожих (можуть бути ОК — це просто звіт):`);
  for (const [a, b, d] of similar.slice(0, 15)) {
    console.log(`  d=${d}: "${a}" <-> "${b}"`);
  }
  if (similar.length > 15) {
    console.log(`  ... ще ${similar.length - 15} пар`);
  }
}

console.log(`\n📊 Підсумок:`);
console.log(`  Всього перевізників: ${carriersAfter.length}`);
console.log(`  Переназвано: ${renamedCount}`);
console.log(`  Залишилось схожих (інформативно): ${similar.length}`);

console.log('\n✅ Готово');
db.close();
