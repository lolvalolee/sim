// scripts/seed-letters.js — Заповнює базу даних початковими листами
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

// Перевіряємо чи вже є листи
const existing = db.prepare('SELECT COUNT(*) as c FROM letters').get();
if (existing.c > 0) {
  console.log(`⚠️  В базі вже є ${existing.c} листів. Видаліть їх вручну якщо хочете переініціалізувати.`);
  console.log('   DELETE FROM letters; — в SQLite браузері або: node -e "require(\'better-sqlite3\')(process.env.DB_PATH||\'./data/simulator.db\').exec(\'DELETE FROM letters\')"');
  process.exit(0);
}

const LETTERS = [
  // ── COMPLETE (повна інформація) ────────────────────────────
  {
    code: 'DE_UA_tent_complete',
    type: 'complete',
    country: 'DE',
    from_name: 'Markus Weber',
    company: 'Weber Logistics GmbH',
    email_addr: 'weber@weberlog.de',
    subject: 'Anfrage Transportdienstleistung München → Lviv',
    body: `Sehr geehrte Damen und Herren,

wir suchen einen zuverlässigen Spediteur für folgende Sendung:

Вантаж:           Деталі машин (12 EUR-палет)
Вага:             14.200 kg / 48 cbm
Адреса завантаж.: München, Leopoldstraße 12, 80802 DE
Адреса розвантаж.:Львів, вул. Промислова 18, UA
Дата завантаження:{loadDate}
Термін доставки:  {delivDate}
Тип кузова:       Тент (Tautliner)
Фрахт:            €2.800 all-in
Документи:        CMR, T1, EUR.1
Митний перехід:   Краковець

Bitte bestätigen.

Mit freundlichen Grüßen,
Markus Weber | +49 89 442 8800`,
    missing: '[]',
    vehicle: 'Тент',
    dirs: '["DE","UA"]',
    freight_fixed: 1,
    freight_amount: 2800,
    freight_min: null,
    freight_max: null,
    carrier_range_min: 1600,
    carrier_range_max: 2200,
    distance: 1800,
    load_day_offset: 4,
    deliv_day_offset: 8,
  },
  {
    code: 'PL_DE_tent_form',
    type: 'form',
    country: 'PL',
    from_name: 'Piotr Kowalski',
    company: 'TransPol Sp. z o.o.',
    email_addr: 'p.kowalski@transpol.pl',
    subject: 'Заявка №TRP-441 — Варшава→Берлін',
    body: `ЗАЯВКА НА ПЕРЕВЕЗЕННЯ №TRP-441
────────────────────────────────
Замовник:       TransPol Sp. z o.o.
Контакт:        Piotr Kowalski, +48 601 234 567
────────────────────────────────
Маршрут:        Варшава (PL) → Берлін (DE)
Адреса завантаж.:ul. Magazynowa 15, Warszawa
Адреса розвантаж.:Berliner Str. 44, 10115 Berlin DE
Дата завантаження:{loadDate}, 08:00
Термін доставки: {delivDate}
Вантаж:         Меблі, 22 EUR-палети, 9.800 kg
Кузов:          Тент | Фрахт: €950 all-in
Документи:      CMR, пакувальний лист
────────────────────────────────`,
    missing: '[]',
    vehicle: 'Тент',
    dirs: '["PL","DE"]',
    freight_fixed: 1,
    freight_amount: 950,
    freight_min: null,
    freight_max: null,
    carrier_range_min: 550,
    carrier_range_max: 780,
    distance: 580,
    load_day_offset: 3,
    deliv_day_offset: 5,
  },
  {
    code: 'DE_UA_adr_complete',
    type: 'complete',
    country: 'DE',
    from_name: 'Klaus Bauer',
    company: 'Bauer Chemie AG',
    email_addr: 'k.bauer@bauerchemie.de',
    subject: 'ADR-Transport: Isopropanol UN1219 Hamburg→Odessa',
    body: `Guten Tag,

ADR-Transport benötigt:

Продукт:      Isopropanol (UN 1219, Клас 3, PG II)
Упаковка:     IBC, 4 × 1.000 kg = 4.000 kg нетто
Адреса завант.:Hamburg, Hafenstraße 91, 20459 DE
Адреса розв.: Одеса, вул. Портова 5, UA
Дата завант.: {loadDate}, 07:00–12:00
Термін дост.: {delivDate}
Фрахт:        €3.800 all-in (ADR-надбавка включена)
Кузов:        ADR Tautliner, Клас 3
Документи:    CMR, ADR-декларація, лист безпеки
Митний перехід: Краковець або Шегині

ADR-допуск водія підтвердити з пропозицією.
Klaus Bauer | +49 40 7721 9900`,
    missing: '[]',
    vehicle: 'ADR Тент',
    dirs: '["DE","UA"]',
    freight_fixed: 1,
    freight_amount: 3800,
    freight_min: null,
    freight_max: null,
    carrier_range_min: 2400,
    carrier_range_max: 3100,
    distance: 2200,
    load_day_offset: 5,
    deliv_day_offset: 9,
  },

  // ── FORM (заявка з повними даними) ─────────────────────────
  {
    code: 'UA_PL_ref_form',
    type: 'form',
    country: 'UA',
    from_name: 'Наталя Борисенко',
    company: 'ФармаЕкспорт ТОВ',
    email_addr: 'n.borisenko@pharmaexport.ua',
    subject: 'Заявка FE-0512 — фармпрепарати Харків→Краків',
    body: `ЗАЯВКА НА МІЖНАРОДНЕ ПЕРЕВЕЗЕННЯ
Номер: FE-0512
════════════════════════════════
ВІДПРАВНИК:
  ФармаЕкспорт ТОВ
  м. Харків, вул. Академічна 33
  Наталя Борисенко, +380 67 445 22 11

ОТРИМУВАЧ:
  Polska Farmacja Sp. z o.o.
  Kraków, ul. Medyczna 8, PL
════════════════════════════════
ВАНТАЖ: Фармпрепарати (не наркотичні)
  4 EUR-палети | 2.350 kg | 14 cbm
  Температура: +2°C до +8°C (РЕФ!)
  Термограф обов'язковий | GDP-вимоги
════════════════════════════════
Завантаження: {loadDate}, 10:00–14:00
Доставка до:  {delivDate}
Документи: CMR, EUR.1, сертифікат якості
Митний перехід: Краковець`,
    missing: '[]',
    vehicle: 'Реф',
    dirs: '["UA","PL"]',
    freight_fixed: 0,
    freight_amount: null,
    freight_min: 1800,
    freight_max: 2400,
    carrier_range_min: 900,
    carrier_range_max: 1400,
    distance: 1200,
    load_day_offset: 5,
    deliv_day_offset: 9,
  },
  {
    code: 'ES_UA_tent_form',
    type: 'form',
    country: 'ES',
    from_name: 'Rodrigo Fernández',
    company: 'IberCargo SL',
    email_addr: 'r.fernandez@ibercargo.es',
    subject: 'Booking #IBC-8821 — Valencia→Zaporizhzhia',
    body: `CARGO BOOKING REQUEST #IBC-8821
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHIPPER: IberCargo SL
  Calle Industria 77, Valencia 46000 ES
  Rodrigo Fernández, +34 961 555 0123

CONSIGNEE: Укр-Авто ТОВ
  м. Запоріжжя, вул. Моторна 14, UA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CARGO: Automotive spare parts
  16 EUR-pallets | 11.200 kg | 40 cbm
  Curtainsider (Tautliner)

Loading:  {loadDate}, 07:00–12:00
Delivery: {delivDate}
Docs: CMR, packing list, invoice, EUR.1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    missing: '[]',
    vehicle: 'Тент',
    dirs: '["ES","UA"]',
    freight_fixed: 0,
    freight_amount: null,
    freight_min: 3800,
    freight_max: 5200,
    carrier_range_min: 2800,
    carrier_range_max: 3800,
    distance: 3400,
    load_day_offset: 6,
    deliv_day_offset: 10,
  },

  // ── MISSING (неповна інформація) ───────────────────────────
  {
    code: 'BE_UA_ref_missing',
    type: 'missing',
    country: 'AE',
    from_name: 'Ahmad Khalil',
    company: 'Gulf Trade FZCO',
    email_addr: 'a.khalil@gulftrade.ae',
    subject: 'Shipping inquiry – dairy products BE→UA',
    body: `Hello,

We need to ship refrigerated goods from Belgium to Ukraine.
The shipment includes dairy products.

Could you please provide us with your rates?

Best regards,
Ahmad Khalil | Gulf Trade FZCO
Tel: +971 50 123 4567`,
    missing: JSON.stringify([
      'Exact loading address in Belgium (city, street, zip)',
      'Exact delivery address in Ukraine (city, street)',
      'Number of pallets and weight (kg)',
      'Temperature regime (°C) for dairy products',
      'Loading readiness date',
      'Required documents (EUR.1, T1, veterinary certificate?)',
    ]),
    vehicle: 'Реф',
    dirs: '["BE","UA"]',
    freight_fixed: 0,
    freight_amount: null,
    freight_min: 3200,
    freight_max: 4500,
    carrier_range_min: 2100,
    carrier_range_max: 3000,
    distance: 2800,
    load_day_offset: 5,
    deliv_day_offset: 9,
  },
  {
    code: 'FR_UA_tent_missing_cancel',
    type: 'missing',
    country: 'FR',
    from_name: 'Jean-Pierre Dubois',
    company: 'Dubois Négoce SA',
    email_addr: 'jp.dubois@duboisnegoce.fr',
    subject: 'Demande de transport — pièces automobiles Lyon→Ukraine',
    body: `Bonjour,

Nous avons besoin d'un transport depuis Lyon vers l'Ukraine.
Pièces automobiles, environ 8 tonnes.
Chargement prêt vers le {loadDate}.

Pourriez-vous nous faire une offre ?

Cordialement,
Jean-Pierre Dubois
Dubois Négoce SA
Tel: +33 4 72 00 00 00`,
    missing: JSON.stringify([
      "Точна адреса відправника в Ліоні (вул., індекс)",
      "Місто та повна адреса отримувача в Україні",
      "Кількість EUR-палет та точна вага",
      "Тип кузова (тент достатньо?)",
      "Перелік документів (EUR.1, CMR, invoice?)",
    ]),
    vehicle: 'Тент',
    dirs: '["FR","UA"]',
    freight_fixed: 0,
    freight_amount: null,
    freight_min: 2200,
    freight_max: 3000,
    carrier_range_min: 1400,
    carrier_range_max: 2000,
    distance: 2000,
    load_day_offset: 5,
    deliv_day_offset: 9,
  },
  {
    code: 'UA_CZ_ref_missing',
    type: 'missing',
    country: 'UA',
    from_name: 'Тетяна Власова',
    company: 'ТОВ «Смаколики»',
    email_addr: 't.vlasova@smakolyky.ua',
    subject: 'Потрібен реф Вінниця→Чехія',
    body: `Привіт!

Нам потрібно відправити заморожені напівфабрикати.
Рефрижератор, з Вінниці кудись у Чехію.
Приблизно 8 тонн.

Коли зможете забрати?`,
    missing: JSON.stringify([
      'Точна адреса завантаження у Вінниці (вул., будинок)',
      'Місто та повна адреса отримувача у Чехії',
      'Кількість EUR-палет',
      'Температурний режим (°C) — мінус скільки?',
      'Дата готовності до завантаження',
      'Документи (ветеринарний сертифікат? CMR?)',
    ]),
    vehicle: 'Реф',
    dirs: '["UA","CZ"]',
    freight_fixed: 0,
    freight_amount: null,
    freight_min: 2000,
    freight_max: 2800,
    carrier_range_min: 1200,
    carrier_range_max: 1700,
    distance: 1500,
    load_day_offset: 4,
    deliv_day_offset: 7,
  },
];

const insert = db.prepare(`
  INSERT INTO letters (
    id, code, type, country, from_name, company, email_addr,
    subject, body, missing, vehicle, dirs,
    freight_fixed, freight_amount, freight_min, freight_max,
    carrier_range_min, carrier_range_max, distance,
    load_day_offset, deliv_day_offset, active
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, 1
  )
`);

const insertMany = db.transaction((letters) => {
  for (const l of letters) {
    insert.run(
      uuidv4(), l.code, l.type, l.country, l.from_name, l.company, l.email_addr,
      l.subject, l.body, l.missing, l.vehicle, l.dirs,
      l.freight_fixed ? 1 : 0, l.freight_amount || null, l.freight_min || null, l.freight_max || null,
      l.carrier_range_min, l.carrier_range_max, l.distance,
      l.load_day_offset, l.deliv_day_offset
    );
  }
});

insertMany(LETTERS);

console.log(`\n✅ Додано ${LETTERS.length} листів до бази даних:`);
const byType = { complete: 0, form: 0, missing: 0 };
LETTERS.forEach(l => byType[l.type]++);
console.log(`   Повні (complete): ${byType.complete}`);
console.log(`   Заявки (form):    ${byType.form}`);
console.log(`   Неповні (missing):${byType.missing}`);
console.log('\nТепер лектор може додавати студентів — система автоматично згенерує набори листів.\n');

db.close();
