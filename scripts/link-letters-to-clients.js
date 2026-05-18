// scripts/link-letters-to-clients.js
// Для кожного існуючого листа:
//   1. Знаходить замовника з clients (за країною)
//   2. Генерує реалістичні адреси завантаження/розвантаження + митниці
//   3. Записує в letters (client_id, load_address, unload_address, тощо)
//
// Можна запускати безпечно — пропускає листи у яких client_id вже встановлений.
// З --force переписує заново.

const Database = require('better-sqlite3');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');
db.pragma('foreign_keys = ON');

const FORCE = process.argv.includes('--force');

function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
function randInt(min,max){ return Math.floor(min + Math.random()*(max-min+1)); }

// Шаблони адрес для країн (повторюємо як у seed-clients.js)
const streetPatterns = {
  DE: ['{X}straße {N}', 'Industriestraße {N}', 'Hauptstraße {N}', 'Bahnhofstraße {N}'],
  AT: ['{X}straße {N}', 'Industriestraße {N}', 'Hauptplatz {N}'],
  CH: ['{X}strasse {N}', 'Industriestrasse {N}', 'Bahnhofstrasse {N}'],
  PL: ['ul. {X} {N}', 'ul. Przemysłowa {N}', 'al. Przemysłowa {N}'],
  CZ: ['{X}ova {N}', 'Průmyslová {N}'],
  SK: ['{X}ova {N}', 'Priemyselná {N}'],
  HU: ['{X} utca {N}', 'Ipari út {N}'],
  NL: ['{X}straat {N}', 'Industrieweg {N}', '{X}weg {N}'],
  BE: ['Rue de {X} {N}', 'Chaussée {X} {N}', 'Avenue Industrielle {N}'],
  FR: ['Rue de {X} {N}', 'Avenue {X} {N}', 'Boulevard Industriel {N}'],
  IT: ['Via {X} {N}', 'Via dell\'Industria {N}', 'Corso {X} {N}'],
  ES: ['Calle {X} {N}', 'Avenida Industrial {N}', 'Polígono Industrial {X}'],
  PT: ['Rua {X} {N}', 'Avenida Industrial {N}'],
  GB: ['{N} {X} Industrial Estate', '{N} {X} Park', '{N} {X} Way', '{N} {X} Street'],
  IE: ['{N} {X} Industrial Park', '{N} {X} Road'],
  SE: ['{X}gatan {N}', 'Industrigatan {N}'],
  NO: ['{X}gata {N}', 'Industriveien {N}'],
  FI: ['{X}katu {N}', 'Teollisuuskatu {N}'],
  DK: ['{X}vej {N}', 'Industrivej {N}'],
  RO: ['Strada {X} {N}', 'Bulevardul Industriei {N}'],
  BG: ['ul. {X} {N}', 'Industrialna zona {N}'],
  HR: ['{X}ulica {N}', 'Industrijska {N}'],
  SI: ['{X}cesta {N}', 'Industrijska cona {N}'],
  LT: ['{X}gatvė {N}', 'Pramonės {N}'],
  LV: ['{X}iela {N}'],
  EE: ['{X} tee {N}', 'Tööstuse {N}'],
  TR: ['{X} Sanayi Sitesi {N}', '{X} Bulvarı {N}'],
  GR: ['{X} {N}'],
  MD: ['Str. Industrială {N}'],
  UA: ['вул. {X} {N}', 'вул. Промислова {N}'],
};

const streetNames = {
  DE: ['Werk','Industrie','Hafen','Lager','Fabrik','Mühlen','Bahnhof','Markt'],
  AT: ['Werk','Industrie','Hafen','Lager','Mariahilfer','Schiller'],
  CH: ['Werk','Industrie','Hafen','Bahnhof','Stein','Sonnen'],
  PL: ['Magazynowa','Logistyczna','Krakowska','Lubelska','Wrocławska','Lwowska'],
  CZ: ['Skladová','Průmyslová','Dopravní','Karlova','Komenského'],
  SK: ['Skladová','Priemyselná','Hlavná','Štúrova'],
  HU: ['Raktár','Ipari','Logisztikai','Fő','Kossuth'],
  NL: ['Industrie','Haven','Magazijn','Logistiek','Dorps'],
  BE: ['Industriel','Commerce','Logistique','Belgique','Liège'],
  FR: ['Industriel','Logistique','Commerce','Paris','Pasteur'],
  IT: ['Industria','Logistica','Commercio','Roma','Garibaldi','Verdi'],
  ES: ['Industria','Logística','Comercio','Madrid','Mayor','Real'],
  PT: ['Indústria','Logística','Comércio','Lisboa'],
  GB: ['Industrial','Trade','Commerce','Park','Mill','King','Queen','Victoria'],
  IE: ['Industrial','Trade','Commerce','Park'],
  SE: ['Industri','Logistik','Storgatan','Drottning'],
  NO: ['Industri','Logistikk','Karl Johan','Storgaten'],
  FI: ['Teollisuus','Logistiikka','Mannerheim','Aleksanterin'],
  DK: ['Industri','Logistik','Hovedgade'],
  RO: ['Industriei','Logistică','Comerciale','Republicii','Independenței'],
  BG: ['Industrialna','Logistichna','Vitosha'],
  HR: ['Industrijska','Logistička','Ilica','Vukovarska'],
  SI: ['Industrijska','Logistična','Slovenska','Trubarjeva'],
  LT: ['Pramonės','Logistikos','Gedimino','Vilniaus'],
  LV: ['Rūpniecības','Loģistikas','Brīvības'],
  EE: ['Tööstuse','Logistika','Tartu','Pärnu'],
  TR: ['Sanayi','Lojistik','Atatürk','Cumhuriyet','Bağdat'],
  GR: ['Industrias','Logistikis','Ermou'],
  MD: ['Industrială','Logistică'],
  UA: ['Промислова','Логістична','Складська','Зелена','Городоцька','Стрийська','Замарстинівська'],
};

function genPostcode(country){
  switch(country){
    case 'DE': case 'FR': case 'IT': case 'ES': return randInt(10000,99999).toString();
    case 'PL': return randInt(10,99)+'-'+randInt(100,999);
    case 'NL': return randInt(1000,9999)+' '+pick(['AB','BC','CD','DE','EF','GH','JK']);
    case 'GB': return pick(['SW','NW','SE','EC','M','B','L','LS'])+randInt(1,99)+' '+randInt(1,9)+pick(['AB','CD','EF']);
    case 'AT': case 'CH': case 'BE': case 'DK': return randInt(1000,9999).toString();
    case 'PT': return randInt(1000,9999)+'-'+randInt(100,999);
    case 'SE': case 'NO': return randInt(100,999)+' '+randInt(10,99);
    case 'UA': return randInt(10000,99999).toString();
    default: return randInt(10000,99999).toString();
  }
}

const cities = {
  DE: ['Frankfurt am Main','München','Berlin','Hamburg','Köln','Stuttgart','Düsseldorf','Leipzig','Hannover','Nürnberg','Dortmund','Bremen','Essen','Dresden','Mannheim'],
  AT: ['Wien','Graz','Linz','Salzburg','Innsbruck','Klagenfurt'],
  CH: ['Zürich','Genève','Basel','Lausanne','Bern'],
  PL: ['Warszawa','Kraków','Wrocław','Poznań','Gdańsk','Łódź','Lublin','Katowice','Białystok','Rzeszów'],
  CZ: ['Praha','Brno','Ostrava','Plzeň','Liberec','Olomouc'],
  SK: ['Bratislava','Košice','Prešov','Žilina','Banská Bystrica','Nitra'],
  HU: ['Budapest','Debrecen','Szeged','Miskolc','Pécs','Győr'],
  NL: ['Rotterdam','Amsterdam','Eindhoven','Utrecht','Den Haag','Tilburg','Groningen'],
  BE: ['Brussels','Antwerpen','Gent','Liège','Brugge'],
  FR: ['Paris','Lyon','Marseille','Toulouse','Nice','Nantes','Strasbourg','Bordeaux','Lille'],
  IT: ['Milano','Roma','Torino','Bologna','Verona','Napoli','Firenze','Genova','Padova'],
  ES: ['Madrid','Barcelona','Valencia','Sevilla','Zaragoza','Bilbao','Murcia','Málaga'],
  PT: ['Lisboa','Porto','Braga','Coimbra'],
  GB: ['London','Manchester','Birmingham','Liverpool','Leeds','Glasgow','Sheffield','Bristol'],
  IE: ['Dublin','Cork','Galway','Limerick'],
  SE: ['Stockholm','Göteborg','Malmö','Uppsala'],
  NO: ['Oslo','Bergen','Trondheim','Stavanger'],
  FI: ['Helsinki','Tampere','Turku','Espoo'],
  DK: ['København','Aarhus','Odense'],
  RO: ['Bucureşti','Cluj-Napoca','Timişoara','Iaşi','Constanţa','Braşov','Sibiu','Oradea'],
  BG: ['Sofia','Plovdiv','Varna','Burgas'],
  HR: ['Zagreb','Split','Rijeka','Osijek'],
  SI: ['Ljubljana','Maribor','Celje'],
  LT: ['Vilnius','Kaunas','Klaipėda','Šiauliai'],
  LV: ['Riga','Daugavpils','Liepāja'],
  EE: ['Tallinn','Tartu','Pärnu'],
  TR: ['Istanbul','Ankara','Izmir','Bursa','Antalya'],
  GR: ['Athens','Thessaloniki','Patras'],
  MD: ['Chișinău','Bălți'],
  UA: ['Львів','Київ','Одеса','Харків','Дніпро','Запоріжжя','Івано-Франківськ','Чернівці','Луцьк','Тернопіль','Рівне','Хмельницький','Вінниця','Ужгород','Полтава'],
};

const namesByCountry = {
  DE: { f:['Andreas','Klaus','Werner','Stefan','Michael','Thomas','Jürgen','Hans','Peter','Karl','Bernd','Markus','Sabine','Petra','Andrea'], l:['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Bauer','Wagner','Becker','Hoffmann'] },
  AT: { f:['Wolfgang','Stefan','Klaus','Michael','Thomas'], l:['Gruber','Huber','Bauer','Wagner','Schmid'] },
  CH: { f:['Hans','Peter','Daniel','Marco','Stefan'], l:['Müller','Meier','Schmid','Keller','Weber'] },
  PL: { f:['Tomasz','Krzysztof','Piotr','Paweł','Andrzej','Michał','Adam','Marek','Łukasz'], l:['Kowalski','Wójcik','Nowak','Wiśniewski','Dąbrowski','Kamiński'] },
  CZ: { f:['Pavel','Petr','Jan','Jiří','Tomáš','Michal'], l:['Novák','Svoboda','Novotný','Dvořák','Černý'] },
  SK: { f:['Peter','Martin','Tomáš','Ján','Michal'], l:['Horváth','Kováč','Varga','Tóth','Nagy'] },
  HU: { f:['László','István','József','János','Zoltán','Sándor'], l:['Nagy','Kovács','Tóth','Szabó','Horváth'] },
  NL: { f:['Jan','Pieter','Hans','Mark','Bart','Peter'], l:['de Vries','van Dijk','Bakker','Janssen','Visser','Smit'] },
  BE: { f:['Lucas','Lars','Noah','Mathieu','Antoine'], l:['Peeters','Janssens','Maes','Jacobs','Mertens'] },
  FR: { f:['Jean','Pierre','Michel','Philippe','Alain','Nicolas','Olivier','Patrick'], l:['Martin','Bernard','Dubois','Thomas','Robert','Petit','Durand'] },
  IT: { f:['Marco','Andrea','Luca','Stefano','Giuseppe','Roberto','Paolo','Giovanni'], l:['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Ricci'] },
  ES: { f:['José','Antonio','Manuel','Francisco','Juan','David','Javier','Carlos'], l:['García','Rodríguez','González','Fernández','López','Martínez','Sánchez','Pérez'] },
  PT: { f:['João','António','Manuel','Francisco','Carlos','José'], l:['Silva','Santos','Ferreira','Pereira','Oliveira','Costa'] },
  GB: { f:['James','John','David','Michael','Robert','William','Andrew','Paul','Mark'], l:['Smith','Jones','Williams','Brown','Taylor','Davies','Wilson','Evans','Thomas'] },
  IE: { f:['Sean','Patrick','Conor','Liam','Ciaran'], l:["O'Brien","Murphy","O'Sullivan","Walsh","Kelly","Byrne"] },
  SE: { f:['Erik','Lars','Anders','Per','Magnus','Mikael','Johan'], l:['Andersson','Johansson','Karlsson','Nilsson','Eriksson','Larsson','Olsson'] },
  NO: { f:['Lars','Erik','Knut','Jan','Per','Ole'], l:['Hansen','Olsen','Larsen','Andersen','Berg'] },
  FI: { f:['Mika','Jari','Antti','Pekka','Markku'], l:['Korhonen','Virtanen','Mäkinen','Nieminen'] },
  DK: { f:['Lars','Peter','Michael','Jens','Henrik'], l:['Nielsen','Jensen','Hansen','Pedersen','Andersen'] },
  RO: { f:['Andrei','Mihai','Cristian','Adrian','Alexandru','Florin','Gabriel','Ion'], l:['Popescu','Ionescu','Popa','Constantinescu','Stoica','Stan','Munteanu'] },
  BG: { f:['Georgi','Ivan','Dimitar','Stoyan','Nikolay'], l:['Petrov','Ivanov','Dimitrov','Georgiev'] },
  HR: { f:['Marko','Ivan','Luka','Josip','Tomislav'], l:['Horvat','Kovačević','Marković','Babić'] },
  SI: { f:['Andrej','Marko','Janez','Matej'], l:['Novak','Horvat','Kovačič','Krajnc'] },
  LT: { f:['Tomas','Mantas','Darius','Vytautas','Rimas'], l:['Kazlauskas','Petrauskas','Jankauskas','Stankevičius'] },
  LV: { f:['Jānis','Andris','Māris','Edgars'], l:['Bērziņš','Kalniņš','Ozoliņš','Liepiņš'] },
  EE: { f:['Mart','Andres','Toomas','Rein'], l:['Kask','Tamm','Saar','Mägi'] },
  TR: { f:['Mehmet','Mustafa','Ali','Hüseyin','Hasan','İbrahim','Osman'], l:['Yılmaz','Demir','Kaya','Şahin','Çelik','Yıldız','Öztürk'] },
  GR: { f:['Giorgos','Nikos','Dimitris','Yannis','Kostas'], l:['Papadopoulos','Nikolaou','Georgiou','Dimitriou'] },
  MD: { f:['Ion','Mihail','Vasile','Dumitru'], l:['Popescu','Rusu','Cebotari','Lupu'] },
  UA: { f:['Сергій','Микола','Олександр','Петро','Іван','Володимир','Олег','Дмитро','Андрій','Богдан'], l:['Гнатюк','Бойко','Коваленко','Шевченко','Мельник','Кравчук','Іваненко','Петренко','Стефанюк','Гриценко'] },
};

const phoneByCountry = {
  DE: () => '+49 ' + randInt(30,89) + ' ' + randInt(1000000,9999999),
  AT: () => '+43 ' + randInt(1,7) + ' ' + randInt(1000000,9999999),
  CH: () => '+41 ' + randInt(7,9) + ' ' + randInt(10000000,99999999),
  PL: () => '+48 ' + randInt(500000000,799999999),
  CZ: () => '+420 ' + randInt(200000000,799999999),
  SK: () => '+421 ' + randInt(900000000,949999999),
  HU: () => '+36 ' + randInt(200000000,799999999),
  NL: () => '+31 ' + randInt(600000000,699999999),
  BE: () => '+32 ' + randInt(400000000,499999999),
  FR: () => '+33 ' + randInt(100000000,799999999),
  IT: () => '+39 ' + randInt(300000000,399999999),
  ES: () => '+34 ' + randInt(600000000,699999999),
  PT: () => '+351 ' + randInt(900000000,969999999),
  GB: () => '+44 ' + randInt(7000000000,7999999999),
  IE: () => '+353 ' + randInt(80,89) + ' ' + randInt(1000000,9999999),
  SE: () => '+46 ' + randInt(700000000,799999999),
  NO: () => '+47 ' + randInt(40000000,99999999),
  FI: () => '+358 ' + randInt(40,50) + ' ' + randInt(1000000,9999999),
  DK: () => '+45 ' + randInt(20000000,99999999),
  RO: () => '+40 ' + randInt(700000000,799999999),
  BG: () => '+359 ' + randInt(880000000,899999999),
  HR: () => '+385 ' + randInt(90000000,99999999),
  SI: () => '+386 ' + randInt(30000000,49999999),
  LT: () => '+370 ' + randInt(60000000,69999999),
  LV: () => '+371 ' + randInt(20000000,29999999),
  EE: () => '+372 ' + randInt(50000000,59999999),
  TR: () => '+90 ' + randInt(5000000000,5999999999),
  GR: () => '+30 ' + randInt(6900000000,6999999999),
  MD: () => '+373 ' + randInt(60000000,79999999),
  UA: () => '+380 ' + pick(['44','67','97','50','63','98','99','73','93','95']) + randInt(1000000,9999999),
};

function genAddress(country){
  const patterns = streetPatterns[country] || streetPatterns.DE;
  const names = streetNames[country] || streetNames.DE;
  const p = pick(patterns);
  const x = pick(names);
  const n = randInt(1,250);
  const street = p.replace('{X}', x).replace('{N}', n);
  const city = pick(cities[country] || cities.DE);
  const postcode = genPostcode(country);
  return `${street}, ${postcode} ${city}`;
}

function genContact(country){
  const nm = namesByCountry[country] || namesByCountry.DE;
  const first = pick(nm.f);
  const last = pick(nm.l);
  const phoneGen = phoneByCountry[country] || phoneByCountry.DE;
  return {
    name: `${first} ${last}`,
    phone: phoneGen(),
  };
}

// Митниці
function genCustoms(country, isLoadCountry, isUnloadCountry){
  // EU→UA: на завантаженні 90% "на місці", на розвантаженні завжди адреса в UA
  // UA→EU: на завантаженні завжди адреса митниці в UA, на розвантаженні рідко вказують

  if (country === 'UA') {
    // UA митниця — назва терміналу + адреса
    const terminals = [
      'ТОВ «Львівський митний термінал»',
      'ТОВ «Захід-Карго»',
      'ДП «Київський митний пост»',
      'ТОВ «Чоп-Експрес»',
      'Митний пост «Ягодин»',
      'ТОВ «Кордон-Сервіс»',
      'ТОВ «Західна Митна Брокерська Контора»',
    ];
    return pick(terminals) + ', ' + genAddress('UA');
  }

  if (isLoadCountry) {
    // На завантаженні в EU — 90% на місці, 10% митний термінал
    if (Math.random() < 0.90) return 'На місці завантаження';
    return pick(['Zollamt', 'Customs Terminal', 'Logistics Park']) + ', ' + genAddress(country);
  }

  // На розвантаженні в EU — частіше "на місці" або взагалі не вказують
  return Math.random() < 0.7 ? 'На місці розвантаження' : genAddress(country);
}

// Вантажі
const cargoTypes = {
  generic: ['Електроінструменти на палетах','Запчастини автомобільні','Текстиль','Меблі побутові','Обладнання промислове','Хімічні матеріали (немезапасні)','Косметика','Парфумерія','Іграшки','Канцелярські товари','Спортивний інвентар','Електроніка','Полімерні гранули','Будівельні матеріали','Кераміка','Скло пакувальне','Картон і папір','Кабельна продукція','Метизи','Інструменти ручні'],
  reefer: ['Свіжі овочі','Фрукти','Молочна продукція','М\'ясо охолоджене','Морепродукти заморожені','Кондитерські вироби','Шоколад','Йогурти','Сири','Заморожена випічка'],
  bulk: ['Зерно пшениці','Соняшникове насіння','Ячмінь','Кукурудза','Соя','Ріпак'],
  liquid: ['Олія соняшникова','Технічна олива','Хімічна сировина','Розчинники'],
  oversize: ['Промислове обладнання','Контейнер 20DV','Силовий трансформатор','Будівельна техніка'],
  auto: ['Легкові автомобілі (2 шт)','Вживані автомобілі (3 шт)','Спецтехніка'],
};

function genCargo(vehicle){
  let type = 'generic';
  if (/реф|ізотерм|reefer|fridge/i.test(vehicle)) type = 'reefer';
  else if (/цистерн|tank|бензовоз/i.test(vehicle)) type = 'liquid';
  else if (/зерн|самоскид|bulk/i.test(vehicle)) type = 'bulk';
  else if (/трал|платформ|низькорам/i.test(vehicle)) type = 'oversize';
  else if (/автовоз/i.test(vehicle)) type = 'auto';

  const desc = pick(cargoTypes[type]);
  // Вага залежно від типу ТЗ
  let weight;
  if (/бус.*1\.5/i.test(vehicle)) weight = randInt(800, 1400);
  else if (/бус.*3/i.test(vehicle)) weight = randInt(2200, 2900);
  else if (/бус.*5/i.test(vehicle)) weight = randInt(3500, 4800);
  else if (/мега/i.test(vehicle)) weight = randInt(19000, 23500);
  else if (/реф|ізотерм/i.test(vehicle)) weight = randInt(17000, 20000);
  else weight = randInt(18000, 22500); // tent

  // Палети — для тенту/мега/рефа
  let pallets = null, volume = null;
  if (!/цистерн|зерн|самоскид|трал|автовоз|бус/i.test(vehicle)) {
    pallets = randInt(20, 33);
    volume = +(pallets * (0.96 + Math.random() * 0.4)).toFixed(1); // приблизно
  } else if (/бус/i.test(vehicle)) {
    pallets = randInt(4, 12);
    volume = +(pallets * 0.5).toFixed(1);
  }

  return { description: desc, weight, pallets, volume };
}

// ─── Основна логіка ───────────────────────────────────────────

const letters = FORCE
  ? db.prepare('SELECT * FROM letters').all()
  : db.prepare('SELECT * FROM letters WHERE load_address IS NULL OR load_address=""').all();

if (letters.length === 0) {
  console.log('Всі листи вже мають адреси. Запустіть з --force щоб перезаписати.');
  db.close();
  process.exit(0);
}

console.log(`Опрацьовую ${letters.length} лист(ів)...`);

const allClients = db.prepare('SELECT * FROM clients WHERE active=1').all();
if (allClients.length === 0) {
  console.error('❌ У БД немає замовників (clients). Спочатку запустіть seed-clients.js');
  db.close();
  process.exit(1);
}

const clientsByCountry = {};
for (const c of allClients) {
  if (!clientsByCountry[c.country]) clientsByCountry[c.country] = [];
  clientsByCountry[c.country].push(c);
}

const upd = db.prepare(`UPDATE letters SET
  client_id=?, load_address=?, load_contact_name=?, load_contact_phone=?,
  unload_address=?, unload_contact_name=?, unload_contact_phone=?,
  customs_out_address=?, customs_in_address=?,
  cargo_weight_kg=?, cargo_volume_m3=?, cargo_pallets=?, cargo_description=?
  WHERE id=?`);

let linked = 0, skippedNoClient = 0;

const updateAll = db.transaction(arr => {
  for (const l of arr) {
    const dirs = JSON.parse(l.dirs || '[]'); // [from, to] або [from] або [from, mid, to]
    if (!dirs.length) {
      console.warn(`  ⚠ Лист ${l.code} без dirs — пропускаю`);
      continue;
    }
    const fromCountry = dirs[0];
    const toCountry = dirs[dirs.length-1];

    // Замовник — країна листа (звідки прийшов)
    const clientCountry = l.country || fromCountry;
    const clientPool = clientsByCountry[clientCountry];
    if (!clientPool || !clientPool.length) {
      // fallback: будь-який замовник
      const anyClient = allClients[0];
      console.warn(`  ⚠ Лист ${l.code}: немає клієнтів для ${clientCountry}, беру ${anyClient.country}`);
      skippedNoClient++;
      continue;
    }
    const client = pick(clientPool);

    // Адреса завантаження — у країні відправлення
    const loadAddress = genAddress(fromCountry);
    const loadContact = genContact(fromCountry);

    // Адреса розвантаження — у країні призначення
    const unloadAddress = genAddress(toCountry);
    const unloadContact = genContact(toCountry);

    // Митниці
    const customsOut = genCustoms(fromCountry, true, false);
    const customsIn  = genCustoms(toCountry, false, true);

    // Вантаж
    const cargo = genCargo(l.vehicle || 'Тент');

    upd.run(
      client.id,
      loadAddress,
      loadContact.name,
      loadContact.phone,
      unloadAddress,
      unloadContact.name,
      unloadContact.phone,
      customsOut,
      customsIn,
      cargo.weight,
      cargo.volume,
      cargo.pallets,
      cargo.description,
      l.id
    );
    linked++;
  }
});

updateAll(letters);

console.log(`\n✅ Прив'язано ${linked} лист(ів) до замовників`);
if (skippedNoClient > 0) console.log(`⚠ Пропущено ${skippedNoClient} (немає клієнтів)`);
console.log(`\nПриклад одного запису:`);
const sample = db.prepare('SELECT code, load_address, unload_address, customs_out_address, customs_in_address, cargo_description, cargo_weight_kg FROM letters WHERE load_address IS NOT NULL LIMIT 3').all();
sample.forEach(s => {
  console.log(`\n  ${s.code}`);
  console.log(`    Завантаження: ${s.load_address}`);
  console.log(`    Розвантаження: ${s.unload_address}`);
  console.log(`    Замитнення: ${s.customs_out_address}`);
  console.log(`    Розмитнення: ${s.customs_in_address}`);
  console.log(`    Вантаж: ${s.cargo_description} (${s.cargo_weight_kg} кг)`);
});

db.close();
