// scripts/seed-extra-carriers.js — закриває дефіцит перевізників за типами ТЗ
//
// Аналіз показав дефіцити (потрібно/є):
//   Цистерна харчова: 6/1
//   Зерновоз: 11/2
//   Сцепка: 8/2
//   Бензовоз: 3/2
//   Контейнеровоз: 3/1
//   Тент штора: 1/0
//   Низькорамний трал: 1/3 (тут OK)
//
// Додаємо ~30 нових перевізників щоб закрити дефіцити.
// Безпечно запускати кілька разів — пропускає дублікати по name.

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

// Гарантуємо що таблиця і колонка for_exchange існують
const info = db.prepare("PRAGMA table_info(carriers)").all().map(c => c.name);
if (!info.includes('for_exchange')) {
  console.error('❌ Колонка for_exchange не існує. Запустіть міграцію.');
  process.exit(1);
}

const EXTRAS = [
  // ── Цистерни харчові (молоко, олія, вино, патока) — +6 ──
  { n: 'ТОВ «АгроТанк Україна»',       p: 'Олег Гаращук',    ph: '+380 67 412 88 14', d: ['UA','PL','DE','NL','BE'],          t: ['Цистерна харчова'],           r: 0.88, a: 0.50, pers: 'specialist', nat: 'UA' },
  { n: 'ТОВ «ОліяТранс»',              p: 'Сергій Дудник',   ph: '+380 50 224 17 09', d: ['UA','PL','DE','IT','AT'],           t: ['Цистерна харчова','Цистерна хімічна'], r: 0.86, a: 0.48, pers: 'specialist', nat: 'UA' },
  { n: 'ФОП Литвин В.О.',              p: 'Володимир Литвин', ph: '+380 97 552 14 88', d: ['UA','PL','HU','RO','CZ','SK'],      t: ['Цистерна харчова'],           r: 0.84, a: 0.55, pers: 'local',      nat: 'UA' },
  { n: 'ТОВ «MolokoTrans»',            p: 'Андрій Бойчук',   ph: '+380 63 887 22 14', d: ['UA','PL','DE','NL','BE','FR'],       t: ['Цистерна харчова'],           r: 0.91, a: 0.42, pers: 'fridge',     nat: 'UA' },
  { n: 'TankPol Sp. z o.o.',           p: 'Marek Kowalski',  ph: '+48 22 654 11 88',  d: ['PL','UA','DE','BE','NL','CZ'],       t: ['Цистерна харчова','Цистерна хімічна'], r: 0.89, a: 0.46, pers: 'specialist', nat: 'PL' },
  { n: 'TransLiquid s.r.o.',           p: 'Pavel Novák',     ph: '+420 244 887 122',  d: ['CZ','SK','UA','DE','AT','PL'],       t: ['Цистерна харчова'],           r: 0.87, a: 0.52, pers: 'specialist', nat: 'CZ' },

  // ── Цистерни хімічні — +3 (вже 3, додаємо ще 3 щоб був резерв) ──
  { n: 'ТОВ «ХімТранс Захід»',         p: 'Микола Ткач',     ph: '+380 67 778 22 14', d: ['UA','PL','DE','CZ','SK','AT'],       t: ['Цистерна хімічна'],            r: 0.90, a: 0.40, pers: 'specialist', nat: 'UA' },
  { n: 'ChemoTrans GmbH',              p: 'Klaus Bauer',     ph: '+49 30 887 12 44',  d: ['DE','PL','UA','NL','BE','FR','AT'], t: ['Цистерна хімічна','Цистерна харчова'], r: 0.92, a: 0.38, pers: 'specialist', nat: 'DE' },
  { n: 'ФОП Романюк І.С.',             p: 'Іван Романюк',    ph: '+380 50 996 11 22', d: ['UA','PL','HU'],                       t: ['Цистерна хімічна'],            r: 0.83, a: 0.50, pers: 'local',      nat: 'UA' },

  // ── Зерновози — +10 (потреба 11, маємо 2) ──
  { n: 'ТОВ «Зерноекспрес»',           p: 'Богдан Кравчук',  ph: '+380 67 332 11 09', d: ['UA','PL','DE','NL','RO'],            t: ['Зерновоз','Самоскидний'],     r: 0.86, a: 0.62, pers: 'specialist', nat: 'UA' },
  { n: 'ТОВ «АгроКарго Захід»',        p: 'Олександр Мельник', ph: '+380 50 552 33 41', d: ['UA','PL','DE','RO','BG'],          t: ['Зерновоз'],                   r: 0.88, a: 0.58, pers: 'specialist', nat: 'UA' },
  { n: 'ФОП Деркач С.І.',              p: 'Сергій Деркач',   ph: '+380 97 224 14 88', d: ['UA','PL','RO','MD'],                  t: ['Зерновоз'],                   r: 0.81, a: 0.66, pers: 'local',      nat: 'UA' },
  { n: 'ТОВ «Карпатський Зерно»',      p: 'Михайло Стефанюк', ph: '+380 342 88 22 11', d: ['UA','PL','HU','SK','RO'],          t: ['Зерновоз','Сцепка'],         r: 0.84, a: 0.60, pers: 'specialist', nat: 'UA' },
  { n: 'ТОВ «GrainExpress»',           p: 'Дмитро Шевчук',   ph: '+380 67 887 14 22', d: ['UA','PL','DE','NL','BE'],            t: ['Зерновоз'],                   r: 0.89, a: 0.55, pers: 'specialist', nat: 'UA' },
  { n: 'ФОП Гончарук О.М.',            p: 'Олег Гончарук',   ph: '+380 63 442 11 88', d: ['UA','PL','HU','RO'],                  t: ['Зерновоз','Самоскидний'],     r: 0.80, a: 0.68, pers: 'local',      nat: 'UA' },
  { n: 'AgroPol Transport Sp. j.',     p: 'Tomasz Wójcik',   ph: '+48 22 998 44 11',  d: ['PL','UA','DE','NL','RO'],             t: ['Зерновоз'],                   r: 0.87, a: 0.54, pers: 'specialist', nat: 'PL' },
  { n: 'ТОВ «Степовий Експорт»',       p: 'Юрій Петренко',   ph: '+380 50 778 99 14', d: ['UA','PL','DE','NL','BE','FR'],       t: ['Зерновоз'],                   r: 0.88, a: 0.56, pers: 'specialist', nat: 'UA' },
  { n: 'ФОП Сидоренко П.В.',           p: 'Петро Сидоренко', ph: '+380 97 114 88 22', d: ['UA','PL','RO','HU'],                  t: ['Зерновоз'],                   r: 0.79, a: 0.70, pers: 'local',      nat: 'UA' },
  { n: 'ТОВ «Польовий Транс»',         p: 'Володимир Сергієнко', ph: '+380 67 552 88 33', d: ['UA','PL','DE','RO','MD'],          t: ['Зерновоз','Самоскидний'],   r: 0.85, a: 0.62, pers: 'specialist', nat: 'UA' },

  // ── Сцепки (довгі причепи) — +6 (потреба 8, маємо 2) ──
  { n: 'ТОВ «Карпатська Сцепка»',      p: 'Андрій Бабій',    ph: '+380 67 887 44 11', d: ['UA','PL','DE','SK','CZ'],            t: ['Сцепка','Тент'],              r: 0.86, a: 0.58, pers: 'tough',      nat: 'UA' },
  { n: 'ФОП Кравець Р.М.',             p: 'Роман Кравець',   ph: '+380 50 224 99 14', d: ['UA','PL','HU','SK'],                  t: ['Сцепка','Тент'],              r: 0.82, a: 0.66, pers: 'local',      nat: 'UA' },
  { n: 'ТОВ «Захід-Сцепка»',           p: 'Олег Іванчук',    ph: '+380 97 442 11 88', d: ['UA','PL','DE','NL','BE'],            t: ['Сцепка','Тент'],              r: 0.89, a: 0.56, pers: 'tough',      nat: 'UA' },
  { n: 'ТОВ «Євро-Сцепка»',            p: 'Тарас Юрченко',   ph: '+380 67 332 44 22', d: ['UA','PL','DE','IT','AT','FR'],       t: ['Сцепка','Тент'],              r: 0.87, a: 0.54, pers: 'tough',      nat: 'UA' },
  { n: 'CombiTrans Sp. z o.o.',        p: 'Piotr Lewandowski', ph: '+48 22 887 14 22', d: ['PL','UA','DE','NL','BE','CZ'],      t: ['Сцепка','Тент','Мега'],       r: 0.88, a: 0.52, pers: 'tough',      nat: 'PL' },
  { n: 'ФОП Захарчук М.І.',            p: 'Михайло Захарчук', ph: '+380 63 998 14 22', d: ['UA','PL','HU','RO'],                t: ['Сцепка','Тент'],              r: 0.81, a: 0.68, pers: 'local',      nat: 'UA' },

  // ── Бензовози — +2 ──
  { n: 'ТОВ «НафтоТранс UA»',          p: 'Сергій Литвин',   ph: '+380 67 552 11 33', d: ['UA','PL','DE','CZ','SK','HU'],       t: ['Бензовоз'],                   r: 0.91, a: 0.40, pers: 'specialist', nat: 'UA' },
  { n: 'FuelTrans GmbH',               p: 'Stefan Müller',   ph: '+49 30 224 88 11',  d: ['DE','PL','UA','NL','BE','AT'],       t: ['Бензовоз','Цистерна хімічна'], r: 0.93, a: 0.36, pers: 'specialist', nat: 'DE' },

  // ── Контейнеровози — +4 ──
  { n: 'ТОВ «ContainerExpress UA»',    p: 'Юрій Демчук',     ph: '+380 67 887 22 99', d: ['UA','PL','DE','NL','BE'],            t: ['Контейнеровоз'],              r: 0.89, a: 0.55, pers: 'specialist', nat: 'UA' },
  { n: 'ТОВ «Порт-Лінк»',              p: 'Олена Степанюк',  ph: '+380 50 998 44 22', d: ['UA','PL','DE','NL','IT'],            t: ['Контейнеровоз','Платформа'],  r: 0.91, a: 0.50, pers: 'specialist', nat: 'UA' },
  { n: 'TEU Logistics B.V.',           p: 'Jan van der Berg', ph: '+31 10 887 14 22', d: ['NL','BE','DE','PL','UA'],            t: ['Контейнеровоз'],              r: 0.92, a: 0.48, pers: 'specialist', nat: 'NL' },
  { n: 'ТОВ «Балтик-Контейнер»',       p: 'Андрій Петренко', ph: '+380 67 332 99 11', d: ['UA','PL','LT','LV','EE','DE'],       t: ['Контейнеровоз'],              r: 0.87, a: 0.54, pers: 'specialist', nat: 'UA' },

  // ── Тент штора — +2 ──
  { n: 'ТОВ «Штор-Транс»',             p: 'Володимир Гриценко', ph: '+380 67 224 88 33', d: ['UA','PL','DE','CZ','SK','AT'],     t: ['Тент штора','Тент'],          r: 0.88, a: 0.58, pers: 'tough',      nat: 'UA' },
  { n: 'CurtainSide Sp. z o.o.',       p: 'Andrzej Nowak',   ph: '+48 22 554 11 88',  d: ['PL','UA','DE','NL','BE'],             t: ['Тент штора','Тент'],          r: 0.89, a: 0.55, pers: 'tough',      nat: 'PL' },

  // ── Платформа / трал — +2 ──
  { n: 'ТОВ «Спец-Трал UA»',           p: 'Богдан Гнатюк',   ph: '+380 67 887 33 22', d: ['UA','PL','DE','SK','HU','RO'],       t: ['Низькорамний трал','Платформа'], r: 0.90, a: 0.42, pers: 'specialist', nat: 'UA' },
  { n: 'HeavyLift Trans GmbH',         p: 'Wolfgang Hoffmann', ph: '+49 30 998 11 22', d: ['DE','PL','UA','CZ','AT','NL'],        t: ['Низькорамний трал','Платформа','Модульний причіп'], r: 0.93, a: 0.36, pers: 'specialist', nat: 'DE' },
];

// Перевіряю які з них вже є по name — щоб уникнути дублів
const existing = new Set(db.prepare('SELECT name FROM carriers').all().map(r => r.name));

const ins = db.prepare(`INSERT INTO carriers (id,name,person,phone,dirs,vehicle_types,reliability,availability,personality,nationality,for_exchange) VALUES(?,?,?,?,?,?,?,?,?,?,0)`);

const insertAll = db.transaction(arr => {
  let added = 0;
  for (const c of arr) {
    if (existing.has(c.n)) continue;
    ins.run(uuidv4(), c.n, c.p, c.ph, JSON.stringify(c.d), JSON.stringify(c.t), c.r, c.a, c.pers, c.nat);
    added++;
  }
  return added;
});

const added = insertAll(EXTRAS);
console.log(`✓ Додано ${added} нових перевізників (з ${EXTRAS.length} у списку, решта вже існували)`);

// Аудит покриття після додавання
console.log('\n=== Аудит покриття: типи ТЗ ===');
const allCarriers = db.prepare("SELECT vehicle_types FROM carriers WHERE active=1 AND COALESCE(for_exchange,0)=0").all();
const typeCount = {};
for (const c of allCarriers) {
  try {
    const types = JSON.parse(c.vehicle_types);
    for (const t of types) typeCount[t] = (typeCount[t] || 0) + 1;
  } catch(e) {}
}
const sorted = Object.entries(typeCount).sort((a,b) => b[1] - a[1]);
for (const [type, count] of sorted) {
  console.log(`  ${type}: ${count}`);
}

console.log('\n✅ Готово');
db.close();
