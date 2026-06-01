// seed-client-details.js — Деплой 23: реквізити замовників + договори + ЄДРПО перевізників
// Безпечно запускати повторно — заповнює лише порожні поля
// Запуск: node scripts/seed-client-details.js

const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'simulator.db');
const db = new Database(dbPath);

// Вигадані директори (українські імена для UA-замовників, іноземні для решти)
const UA_DIRECTORS = ['Гуменюк В.П.','Петренко О.І.','Іваненко С.М.','Бойко А.В.','Ковальчук Н.Р.','Тарасенко О.Б.','Романюк І.Я.','Шевченко М.К.','Левченко П.А.','Мельник Т.Г.','Шеремета В.І.','Сидоренко Л.М.','Захарчук Д.Б.','Поліщук Г.С.'];
const EU_DIRECTORS = ['Krause M.','Janowski A.','Rossi P.','Müller H.','Dubois L.','Schmidt T.','Novak J.','Horvath G.','Kowalski R.','Černý D.'];

// Українські банки
const UA_BANKS = [
  'АТ КБ "ПРИВАТБАНК"','АТ "Райффайзен Банк"','АТ "Укрсиббанк"','АТ "Ощадбанк"',
  'АТ "Укрексімбанк"','АТ "ОТП Банк"','АТ "Креді Агріколь Банк"','АТ "ПУМБ"',
];

function randIban() {
  // UA + 27 digits
  let s = 'UA';
  for (let i = 0; i < 27; i++) s += Math.floor(Math.random() * 10);
  return s;
}
function randEdrpou() {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 10);
  return s;
}
// Постійний номер договору: 3-значне число + дата 2015-2020
function randContract(seedKey) {
  // Детерміновано від seedKey (company name) щоб одна компанія завжди мала той самий
  let h = 0;
  for (let i = 0; i < seedKey.length; i++) h = (h * 31 + seedKey.charCodeAt(i)) | 0;
  const num = String(100 + Math.abs(h) % 900); // 100-999
  const year = 2015 + Math.abs(h >> 4) % 6;    // 2015-2020
  const month = String(1 + Math.abs(h >> 8) % 12).padStart(2, '0');
  const day = String(1 + Math.abs(h >> 12) % 28).padStart(2, '0');
  return { number: num, date: `${day}.${month}.${year}` };
}

// Список UA-міст для адрес
const UA_CITIES = [
  {city:'Київ',idx:'01001',obl:''},
  {city:'Львів',idx:'79000',obl:'Львівська обл.'},
  {city:'Одеса',idx:'65000',obl:'Одеська обл.'},
  {city:'Дніпро',idx:'49000',obl:'Дніпропетровська обл.'},
  {city:'Харків',idx:'61000',obl:'Харківська обл.'},
  {city:'Рівне',idx:'33000',obl:'Рівненська обл.'},
  {city:'Луцьк',idx:'43000',obl:'Волинська обл.'},
  {city:'Ужгород',idx:'88000',obl:'Закарпатська обл.'},
  {city:'Чернівці',idx:'58000',obl:'Чернівецька обл.'},
  {city:'Хмельницький',idx:'29000',obl:'Хмельницька обл.'},
  {city:'Тернопіль',idx:'46000',obl:'Тернопільська обл.'},
  {city:'Полтава',idx:'36000',obl:'Полтавська обл.'},
  {city:'Черкаси',idx:'18000',obl:'Черкаська обл.'},
  {city:'Вінниця',idx:'21000',obl:'Вінницька обл.'},
];
const STREETS = ['Незалежності','Шевченка','Степанська','Лесі Українки','Сагайдачного','Грушевського','Лесина','Соборна','Чорновола','Дністровська','Київська','Лимарська','Січових Стрільців'];

console.log('[seed-client-details] Старт...');

// 1) Замовники (з листів)
// Беремо унікальні company + country
const clientsRaw = db.prepare(`
  SELECT DISTINCT company, country, from_name
  FROM letters
  WHERE company IS NOT NULL AND company != ''
`).all();
console.log(`[seed-client-details] Унікальних замовників: ${clientsRaw.length}`);

const upd = db.prepare(`
  UPDATE letters SET
    client_address = COALESCE(NULLIF(client_address,''), ?),
    client_iban = COALESCE(NULLIF(client_iban,''), ?),
    client_bank = COALESCE(NULLIF(client_bank,''), ?),
    client_edrpou = COALESCE(NULLIF(client_edrpou,''), ?),
    client_director = COALESCE(NULLIF(client_director,''), ?),
    client_contract_no = COALESCE(NULLIF(client_contract_no,''), ?)
  WHERE company = ?
`);

let count = 0;
const tx = db.transaction(() => {
  for (const c of clientsRaw) {
    const seedKey = c.company + (c.country || '');
    const contract = randContract(seedKey);
    const contractFull = `№ ${contract.number} від ${contract.date}р.`;
    let address, iban, bank, edrpou, director;
    if (c.country === 'UA' || !c.country) {
      const city = UA_CITIES[Math.abs(seedKey.length) % UA_CITIES.length];
      const street = STREETS[Math.abs(seedKey.charCodeAt(0) || 0) % STREETS.length];
      const houseNo = 1 + (Math.abs(seedKey.length * 7) % 200);
      address = `вул. ${street}, ${houseNo}, м. ${city.city}${city.obl ? ', ' + city.obl : ''}, ${city.idx}`;
      iban = randIban();
      bank = UA_BANKS[Math.abs(seedKey.length * 3) % UA_BANKS.length] + (city.city === 'Київ' ? '' : ` у м. ${city.city}`);
      edrpou = randEdrpou();
      director = UA_DIRECTORS[Math.abs(seedKey.length * 11) % UA_DIRECTORS.length];
    } else {
      // EU/інше
      address = `${1 + (Math.abs(seedKey.length) % 200)} ${STREETS[0]} St., ${c.country || 'EU'}`;
      iban = randIban().replace(/^UA/, c.country === 'PL' ? 'PL' : (c.country === 'DE' ? 'DE' : 'EU'));
      bank = 'Bank ' + c.country;
      edrpou = '';
      director = EU_DIRECTORS[Math.abs(seedKey.length) % EU_DIRECTORS.length];
    }
    upd.run(address, iban, bank, edrpou, director, contractFull, c.company);
    count++;
  }
});
tx();
console.log(`[seed-client-details] ✓ Оновлено реквізити для ${count} замовників`);

// 2) Перевізники — ЄДРПО і адреса
const carriers = db.prepare('SELECT id, name, nationality FROM carriers WHERE edrpou IS NULL OR edrpou=""').all();
const updCarr = db.prepare('UPDATE carriers SET edrpou=?, address=? WHERE id=?');
const txC = db.transaction(() => {
  for (const c of carriers) {
    const edrpou = (c.nationality === 'UA' || !c.nationality) ? randEdrpou() : '';
    const city = UA_CITIES[(c.id||'').charCodeAt(0) % UA_CITIES.length];
    const addr = (c.nationality === 'UA' || !c.nationality)
      ? `м. ${city.city}, вул. ${STREETS[(c.id||'').charCodeAt(1) % STREETS.length]}, ${1 + ((c.id||'').charCodeAt(2) % 100)}`
      : `${c.nationality} address`;
    updCarr.run(edrpou, addr, c.id);
  }
});
txC();
console.log(`[seed-client-details] ✓ Оновлено реквізити для ${carriers.length} перевізників`);

db.close();
console.log('[seed-client-details] Готово.\n');
