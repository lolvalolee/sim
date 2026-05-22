// scripts/seed-letters-v2.js
// Повна заміна листів — 120 нових з таблиці Симулятор 1.2
// Видаляє ВСІ старі letters, генерує нові з повними даними.
//
// УВАГА: видаляє і всі залежні дані (email_threads, order_progress тощо).
// Запускати ТІЛЬКИ при повному ресеті БД!

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = OFF'); // тимчасово вимикаємо для каскадного видалення

const DATA_FILE = path.join(__dirname, 'letters_data.json');
if (!fs.existsSync(DATA_FILE)) {
  console.error('❌ letters_data.json не знайдено в', DATA_FILE);
  process.exit(1);
}

const records = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
console.log(`Зчитано ${records.length} записів з letters_data.json`);

// ── 1. Видаляємо всі залежні дані ──
console.log('\n🗑  Видаляю старі дані...');
const tables = [
  'order_events',
  'order_progress',
  'email_threads',
  'carrier_chats',
  'applications',
  'confirmations',  // якщо існує
  'assignments',
  'sessions',
  'letters',
];

for (const t of tables) {
  try {
    const before = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
    db.prepare(`DELETE FROM ${t}`).run();
    console.log(`  ✓ ${t}: видалено ${before}`);
  } catch(e) {
    console.log(`  • ${t}: не існує або не вдалось видалити (${e.message.slice(0,50)})`);
  }
}

// ── 2. Генеруємо реалістичні адреси з шаблонів ──
const ADDR_TEMPLATES = [
  'вул. Промислова {n}, {city}',
  'вул. Заводська {n}, {city}',
  'вул. Складська {n}, {city}',
  'вул. Логістична {n}, {city}',
  'просп. Трудовий {n}, {city}',
  'вул. Виробнича {n}, {city}',
  'вул. Транспортна {n}, {city}',
  'вул. Незалежності {n}, {city}',
];
const EU_TEMPLATES = [
  '{city}, Industriestrasse {n}',
  '{city}, Logistics Park, {n}',
  '{city}, ul. Przemysłowa {n}',
  '{city}, Strada Industriei {n}',
  '{city}, Calle Industrial {n}',
  '{city}, Via dell\'Industria {n}',
];

function pickAddress(city, country) {
  const n = Math.floor(Math.random() * 80) + 5;
  if (country === 'UA') {
    const tmpl = ADDR_TEMPLATES[Math.floor(Math.random() * ADDR_TEMPLATES.length)];
    return tmpl.replace('{n}', n).replace('{city}', city);
  }
  const tmpl = EU_TEMPLATES[Math.floor(Math.random() * EU_TEMPLATES.length)];
  return tmpl.replace('{n}', n).replace('{city}', city);
}

// Контактні особи (українські і європейські)
const UA_NAMES = ['Володимир Коваленко', 'Олег Петренко', 'Андрій Шевчук', 'Михайло Лесів',
  'Сергій Іванчук', 'Тарас Мельник', 'Ігор Дудник', 'Богдан Кравчук',
  'Олена Бойко', 'Ірина Гриценко', 'Наталія Поліщук'];
const EU_NAMES_BY_COUNTRY = {
  DE: ['Klaus Müller','Stefan Schmidt','Andreas Weber','Helmut Becker','Werner Fischer'],
  PL: ['Tomasz Wójcik','Piotr Lewandowski','Marek Nowak','Andrzej Kowalski','Krzysztof Zieliński'],
  IT: ['Marco Rossi','Giuseppe Bianchi','Luca Romano','Antonio Conti','Stefano Marino'],
  FR: ['Jean Dupont','Pierre Martin','Michel Bernard','François Petit','Luc Moreau'],
  ES: ['Juan García','Carlos Martínez','Antonio López','Manuel Sánchez','José Rodríguez'],
  NL: ['Jan de Vries','Peter van Berg','Hans Bakker','Willem Visser','Karel Smit'],
  GB: ['John Smith','David Brown','Michael Wilson','James Taylor','Robert Anderson'],
  CZ: ['Pavel Novák','Tomáš Svoboda','Jiří Dvořák','Petr Černý','Jan Procházka'],
  SK: ['Peter Horváth','Ján Kováč','Milan Tóth','Štefan Varga','Marek Balog'],
  HU: ['László Nagy','István Kovács','András Szabó','József Tóth','Gábor Horváth'],
  RO: ['Ion Popescu','Andrei Ionescu','Mihai Popa','Stefan Dumitru','Radu Constantin'],
  AT: ['Hans Gruber','Franz Wagner','Wolfgang Bauer','Klaus Hofer','Stefan Pichler'],
  CH: ['Hans Müller','Markus Keller','Stefan Brunner','Thomas Frei','Daniel Steiner'],
  BE: ['Jan Janssens','Marc Peeters','Patrick Maes','Luc Vermeulen','Eric De Smet'],
  BG: ['Ivan Petrov','Stoyan Dimitrov','Georgi Ivanov','Nikolay Stoyanov','Plamen Todorov'],
  GR: ['Yiannis Papadakis','Dimitris Georgiou','Nikos Andreou','Kostas Petros','Manolis Ioannou'],
  TR: ['Mehmet Yılmaz','Ahmet Kaya','Mustafa Demir','Hasan Şahin','Hüseyin Çelik'],
  SE: ['Anders Andersson','Erik Eriksson','Lars Larsson','Per Persson','Karl Karlsson'],
  NO: ['Ole Hansen','Per Olsen','Lars Pedersen','Knut Larsen','Hans Andersen'],
  DK: ['Lars Jensen','Niels Andersen','Peter Nielsen','Anders Hansen','Erik Christensen'],
  FI: ['Pekka Korhonen','Matti Virtanen','Jukka Nieminen','Kari Mäkinen','Mikko Heikkinen'],
  EE: ['Mart Tamm','Jaan Saar','Andres Kask','Mihkel Mets','Tõnu Lepp'],
  LT: ['Aleksas Petrauskas','Vytautas Jonaitis','Algirdas Stankevičius','Kęstutis Vaitkus','Tomas Žukauskas'],
  LV: ['Andris Bērziņš','Jānis Kalniņš','Pēteris Ozols','Edgars Liepa','Māris Vītols'],
  PT: ['João Silva','Manuel Santos','Pedro Costa','Carlos Ferreira','Rui Marques'],
  IE: ['John O\'Brien','Patrick Murphy','Michael Kelly','David Walsh','James Byrne'],
  MD: ['Andrei Cojocaru','Vladimir Rusu','Mihai Ciobanu','Ion Munteanu','Sergiu Lupu'],
  SI: ['Janez Novak','Marko Kovač','Andrej Horvat','Matej Krajnc','Tomaž Zupančič'],
  HR: ['Marko Horvat','Ivan Kovačić','Tomislav Babić','Stjepan Jurić','Ante Marić'],
  RS: ['Marko Jovanović','Stefan Petrović','Aleksandar Nikolić','Dušan Stojanović','Milan Đorđević'],
  ME: ['Marko Popović','Stefan Vuković','Aleksandar Pavlović','Nikola Jovanović','Milan Radović'],
  MK: ['Marko Stojanovski','Stefan Petrovski','Aleksandar Nikolovski','Dimitar Jovanovski','Ilija Trajkovski'],
  AL: ['Andi Hoxha','Besim Krasniqi','Ardian Berisha','Edmond Gjoni','Fatos Shabani'],
  BA: ['Adnan Mehmedović','Senad Hadžić','Mirza Begić','Edin Tahirović','Almir Suljić'],
  XK: ['Arben Krasniqi','Besim Hoxha','Driton Berisha','Genc Shala','Lirim Bytyqi'],
  CY: ['Andreas Constantinou','Nikolas Christou','Marios Georgiou','Pavlos Papadopoulos','Costas Stylianou'],
  MT: ['Joseph Borg','Mario Camilleri','Paul Vella','Anthony Farrugia','Carmel Grech'],
  IS: ['Jón Jónsson','Sigurður Sigurðsson','Ólafur Gunnarsson','Einar Þórsson','Ari Magnússon'],
  LU: ['Pierre Schmit','Jean Weber','Marc Müller','Paul Schneider','Yves Klein'],
  AD: ['Joan Garcia','Marc Pujol','Andreu Vidal','Carles Roca','Jordi Vila'],
};

function pickContact(country) {
  if (country === 'UA') return UA_NAMES[Math.floor(Math.random() * UA_NAMES.length)];
  const list = EU_NAMES_BY_COUNTRY[country];
  if (list) return list[Math.floor(Math.random() * list.length)];
  return 'Manager Office';
}

function pickPhone(country) {
  const r = () => Math.floor(Math.random() * 10);
  if (country === 'UA') return `+380 ${r()}${r()} ${r()}${r()}${r()} ${r()}${r()} ${r()}${r()}`;
  const codes = {
    DE:'49',PL:'48',IT:'39',FR:'33',ES:'34',NL:'31',GB:'44',CZ:'420',SK:'421',
    HU:'36',RO:'40',AT:'43',CH:'41',BE:'32',BG:'359',GR:'30',TR:'90',SE:'46',
    NO:'47',DK:'45',FI:'358',EE:'372',LT:'370',LV:'371',PT:'351',IE:'353',
    MD:'373',SI:'386',HR:'385',RS:'381',ME:'382',MK:'389',AL:'355',BA:'387',
    XK:'383',CY:'357',MT:'356',IS:'354',LU:'352',AD:'376'
  };
  const cc = codes[country] || '49';
  return `+${cc} ${r()}${r()}${r()} ${r()}${r()}${r()} ${r()}${r()}${r()}${r()}`;
}

// Митні переходи по країнах
function pickCustomsOut(fromCountry) {
  // Якщо UA -> EU, замитнення зазвичай на місці завантаження або в Україні
  // Якщо EU -> UA, замитнення в EU країні (на терміналі)
  if (fromCountry === 'UA') return 'на місці завантаження';
  return 'на терміналі';
}

function pickCustomsIn(toCountry) {
  if (toCountry !== 'UA') return 'на місці розвантаження';
  // UA розмитнення — митний пост
  const posts = [
    'Митний пост «Ягодин», вул. Промислова 66, 70945 Львів',
    'Митний пост «Шегині», Львівська область',
    'Митний пост «Краківець», вул. Краківецька 1, Львівська область',
    'Митний пост «Ужгород-Захід», Закарпатська область',
    'Митний пост «Чоп», вул. Митна 1, Закарпатська область',
  ];
  return posts[Math.floor(Math.random() * posts.length)];
}

function pickBorderCrossing(fromCountry, toCountry) {
  // Залежить від маршруту
  const otherCountry = fromCountry === 'UA' ? toCountry : fromCountry;
  // Південні країни — через Чоп/Ужгород
  const south = ['HU','RO','SK','BG','GR','TR','MD','RS','ME','MK','AL','BA','HR','SI','IT','AT','CH'];
  // Західні/північні — через Шегині/Краківець
  if (south.includes(otherCountry)) {
    return ['Чоп - Záhony (UA-HU)', 'Ужгород - Vyšné Nemecké (UA-SK)', 'Дякове - Halmeu (UA-RO)'][Math.floor(Math.random()*3)];
  }
  return ['Шегині - Medyka (UA-PL)', 'Краківець - Korczowa (UA-PL)', 'Рава-Руська - Hrebenne (UA-PL)'][Math.floor(Math.random()*3)];
}

// ── 3. Витягуємо приховані дані з task_hint якщо є ──
// task_hint = "Запитати розмір і кількість палет. (будуть 120х80х180 30шт)"
// hidden_data = {"палети": "120х80х180, 30 шт"}
function extractHiddenData(taskHint) {
  if (!taskHint) return {};
  const hidden = {};

  // Шукаємо у дужках: "(будуть 120х80х180 30шт)" або "(120х80х180 30шт)"
  const paletMatch = taskHint.match(/\(\s*(?:будуть\s+)?([0-9х×x]+(?:см)?\s*\d+\s*шт?)\s*\)/i);
  if (paletMatch && /палет/i.test(taskHint)) {
    hidden['палети'] = paletMatch[1].trim();
  }

  // Температурний режим: "(-18)", "(+5)", "(+3/+7)"
  const tempMatch = taskHint.match(/\(([+\-]\d+(?:\/[+\-]\d+)?)\)/);
  if (tempMatch && /температур/i.test(taskHint)) {
    hidden['температура'] = tempMatch[1].trim();
  }

  // Вага: "(20т)", "(18т)"
  const wMatch = taskHint.match(/\((\d+(?:[.,]\d+)?\s*т)\)/i);
  if (wMatch && /(вагу|вага)/i.test(taskHint)) {
    hidden['вага'] = wMatch[1].trim();
  }

  return hidden;
}

// Темам листів
const SUBJECTS = {
  'тент': ['Запит на перевезення', 'Вантаж готовий', 'Потрібне авто', 'Завантаження'],
  'реф': ['Реф потрібен', 'Перевезення з температурним режимом', 'Запит на реф'],
  'мега': ['Об\'ємний вантаж', 'Запит на мегу'],
  'самоскид': ['Сипкий вантаж', 'Самоскид потрібен'],
  'цистерна': ['Перевезення наливом', 'Запит на цистерну'],
  'трал': ['Негабарит', 'Перевезення трал'],
  'платформа': ['Платформа потрібна', 'Габаритний вантаж'],
  'контейтеровоз': ['Контейнер 40фут', 'Запит на контейнеровоз'],
  'сцепка (тандем)': ['Велика тоннажність', 'Запит на сцепку'],
};

function pickSubject(vehicle, fromCity, toCity) {
  const list = SUBJECTS[vehicle] || ['Запит на перевезення'];
  return `${list[Math.floor(Math.random()*list.length)]}: ${fromCity} (${fromCity === toCity ? 'UA' : ''}) — ${toCity}`;
}

// ── 4. Створюємо клієнтів якщо потрібні ──
function ensureClient(country, city, contactPerson) {
  // Пробуємо знайти існуючого клієнта у тому ж місті
  const existing = db.prepare("SELECT id, person FROM clients WHERE city LIKE ? AND active=1 LIMIT 1").get('%' + city + '%');
  if (existing) {
    return existing.id;
  }
  // Створюємо нового
  const id = uuidv4();
  const companyTypes = country === 'UA'
    ? ['ТОВ', 'ФОП', 'ТзОВ', 'ПП']
    : ['GmbH', 'Sp. z o.o.', 'S.A.', 'Ltd.', 'S.r.l.', 'B.V.'];
  const typeWord = companyTypes[Math.floor(Math.random() * companyTypes.length)];
  const surname = contactPerson.split(' ').pop();
  const company = country === 'UA'
    ? `${typeWord} «${surname}-Логістик»`
    : `${surname} Trans ${typeWord}`;

  db.prepare(`INSERT INTO clients (id,company,person,country,city,address,phone,email,business_type,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,datetime('now'))`)
    .run(
      id,
      company,
      contactPerson,
      country,
      city,
      pickAddress(city, country),
      pickPhone(country),
      `${surname.toLowerCase().replace(/[^\w]/g,'')}@${company.toLowerCase().replace(/[^\w]/g,'').slice(0,15)}.com`,
      'general'
    );
  return id;
}

// ── 5. Створюємо листи ──
console.log('\n📝 Створюю нові листи...');

let createdCount = 0;
for (const rec of records) {
  const id = uuidv4();
  const loadContact = pickContact(rec.from_country);
  const unloadContact = pickContact(rec.to_country);
  const loadAddr = pickAddress(rec.from_city, rec.from_country);
  const unloadAddr = pickAddress(rec.to_city, rec.to_country);
  const customsOut = pickCustomsOut(rec.from_country);
  const customsIn = pickCustomsIn(rec.to_country);

  const fromName = pickContact(rec.from_country);
  const clientId = ensureClient(rec.from_country, rec.from_city, fromName);

  // Hidden_data із task_hint
  const hidden = extractHiddenData(rec.task_hint);

  // Lang: рівень 1 = українська, рівень 2 = мова країни
  // Зараз ставимо всім UA — використається групою рівня 1
  // У майбутньому AI-промпт враховує groups.difficulty

  // Тіло листа — короткий деловий стиль
  const body = `Доброго дня!

${rec.letter_text}

Маршрут: ${rec.from_city} (${rec.from_country}) — ${rec.to_city} (${rec.to_country})
Тип ТЗ: ${rec.vehicle_required}
Орієнтовний фрахт: €${rec.freight}
Умови поставки: ${rec.incoterms}

Очікую вашої пропозиції.

З повагою,
${fromName}`;

  // Завантажуємо у БД
  db.prepare(`INSERT INTO letters (
    id, code, type, client_id, from_name, company, email_addr, country, subject, body,
    dirs, vehicle, freight_fixed, freight_amount, freight_min, freight_max,
    cargo_description, cargo_weight_kg, incoterms,
    load_address, load_contact_name, load_contact_phone,
    unload_address, unload_contact_name, unload_contact_phone,
    customs_out_address, customs_in_address,
    vehicle_alternatives, hidden_data, task_hint,
    difficulty, difficulty_level, distance, distance_km,
    scenario, load_day_offset, missing, active, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',1,datetime('now'))`)
  .run(
    id,
    `L${String(createdCount + 1).padStart(4, '0')}`,  // code: L0001, L0002...
    'complete',  // type: complete/missing/form (CHECK constraint)
    clientId, fromName,
    db.prepare('SELECT company FROM clients WHERE id=?').get(clientId)?.company || 'Компанія',
    `letter${createdCount + 1}@example.com`,
    rec.from_country,
    pickSubject(rec.vehicle_required, rec.from_city, rec.to_city),
    body,
    JSON.stringify([rec.from_country, rec.to_country]),
    rec.vehicle_required,
    1, // freight_fixed
    rec.freight, rec.freight, rec.freight,
    rec.letter_text,
    null, // cargo_weight_kg — буде у hidden якщо є
    rec.incoterms,
    loadAddr, loadContact, pickPhone(rec.from_country),
    unloadAddr, unloadContact, pickPhone(rec.to_country),
    customsOut, customsIn,
    JSON.stringify(rec.vehicle_alternatives),
    JSON.stringify(hidden),
    rec.task_hint,
    rec.difficulty,  // старе поле
    rec.difficulty,  // нове поле difficulty_level (теж заповнюємо)
    rec.distance_km,  // старе поле distance
    rec.distance_km,  // нове поле distance_km
    'agree',
    Math.floor(Math.random() * 4) + 2, // 2-5 днів від старту
  );
  createdCount++;
}

console.log(`✓ Створено ${createdCount} листів`);

// Статистика
console.log('\n📊 Статистика:');
const byVehicle = db.prepare("SELECT vehicle, COUNT(*) as c FROM letters WHERE active=1 GROUP BY vehicle ORDER BY c DESC").all();
console.log('Типи ТЗ:');
byVehicle.forEach(r => console.log(`  ${r.vehicle}: ${r.c}`));

const byDiff = db.prepare("SELECT difficulty_level, COUNT(*) as c FROM letters WHERE active=1 GROUP BY difficulty_level").all();
console.log('Складність:');
byDiff.forEach(r => console.log(`  ${r.difficulty_level || 'не вказано'}: ${r.c}`));

const totalClients = db.prepare("SELECT COUNT(*) as c FROM clients WHERE active=1").get().c;
console.log(`\nЗамовників в БД: ${totalClients}`);

console.log('\n✅ Seed завершено успішно');
db.close();
