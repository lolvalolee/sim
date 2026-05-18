// scripts/seed-clients.js — генерує 80 замовників з повними реквізитами
// Прив'язка до листів — окремим скриптом link-letters-to-clients.js
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

// Безпека — не перезаповнюємо
const existing = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;
if (existing > 0) {
  console.log(`Clients already seeded: ${existing}. Skipping. Run with --force to override.`);
  if (!process.argv.includes('--force')) {
    db.close();
    process.exit(0);
  }
  db.exec('DELETE FROM clients');
  console.log('• --force: cleared old clients');
}

function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
function randInt(min, max){ return Math.floor(min + Math.random()*(max-min+1)); }

// Генератори VAT
const vat = {
  DE: () => 'DE ' + randInt(100,999) + ' ' + randInt(100,999) + ' ' + randInt(100,999),
  PL: () => 'PL ' + randInt(1000000000, 9999999999),
  CZ: () => 'CZ' + randInt(10000000, 99999999),
  SK: () => 'SK' + randInt(1000000000, 9999999999),
  HU: () => 'HU' + randInt(10000000, 99999999),
  AT: () => 'ATU' + randInt(10000000, 99999999),
  NL: () => 'NL' + randInt(100000000, 999999999) + 'B' + randInt(10,99),
  BE: () => 'BE0' + randInt(100000000, 999999999),
  FR: () => 'FR ' + randInt(10, 99) + ' ' + randInt(100000000, 999999999),
  IT: () => 'IT' + randInt(10000000000, 99999999999),
  ES: () => 'ES B' + randInt(10000000, 99999999),
  PT: () => 'PT' + randInt(100000000, 999999999),
  GB: () => 'GB ' + randInt(100, 999) + ' ' + randInt(1000, 9999) + ' ' + randInt(10, 99),
  IE: () => 'IE ' + randInt(1000000, 9999999) + 'A',
  SE: () => 'SE' + randInt(100000000000, 999999999999),
  NO: () => 'NO' + randInt(100000000, 999999999) + 'MVA',
  FI: () => 'FI' + randInt(10000000, 99999999),
  DK: () => 'DK ' + randInt(10000000, 99999999),
  RO: () => 'RO ' + randInt(10000000, 99999999),
  BG: () => 'BG' + randInt(100000000, 999999999),
  HR: () => 'HR' + randInt(10000000000, 99999999999),
  SI: () => 'SI' + randInt(10000000, 99999999),
  LT: () => 'LT' + randInt(100000000, 999999999),
  LV: () => 'LV' + randInt(10000000000, 99999999999),
  EE: () => 'EE' + randInt(100000000, 999999999),
  CH: () => 'CHE-' + randInt(100, 999) + '.' + randInt(100, 999) + '.' + randInt(100, 999),
  TR: () => 'TR ' + randInt(1000000000, 9999999999),
  GR: () => 'EL' + randInt(100000000, 999999999),
  MD: () => 'MD ' + randInt(1000000, 9999999),
  UA: () => randInt(30000000, 49999999).toString(),  // ЄДРПОУ — 8 цифр
};

const phone = {
  DE: () => '+49 ' + randInt(30, 89) + ' ' + randInt(1000000, 9999999),
  PL: () => '+48 ' + randInt(500000000, 799999999),
  CZ: () => '+420 ' + randInt(200000000, 799999999),
  SK: () => '+421 ' + randInt(900000000, 949999999),
  HU: () => '+36 ' + randInt(200000000, 799999999),
  AT: () => '+43 ' + randInt(1, 7) + ' ' + randInt(1000000, 9999999),
  NL: () => '+31 ' + randInt(600000000, 699999999),
  BE: () => '+32 ' + randInt(400000000, 499999999),
  FR: () => '+33 ' + randInt(100000000, 799999999),
  IT: () => '+39 ' + randInt(300000000, 399999999),
  ES: () => '+34 ' + randInt(600000000, 699999999),
  PT: () => '+351 ' + randInt(900000000, 969999999),
  GB: () => '+44 ' + randInt(7000000000, 7999999999),
  IE: () => '+353 ' + randInt(80, 89) + ' ' + randInt(1000000, 9999999),
  SE: () => '+46 ' + randInt(700000000, 799999999),
  NO: () => '+47 ' + randInt(40000000, 99999999),
  FI: () => '+358 ' + randInt(40, 50) + ' ' + randInt(1000000, 9999999),
  DK: () => '+45 ' + randInt(20000000, 99999999),
  RO: () => '+40 ' + randInt(700000000, 799999999),
  BG: () => '+359 ' + randInt(880000000, 899999999),
  HR: () => '+385 ' + randInt(90000000, 99999999),
  SI: () => '+386 ' + randInt(30000000, 49999999),
  LT: () => '+370 ' + randInt(60000000, 69999999),
  LV: () => '+371 ' + randInt(20000000, 29999999),
  EE: () => '+372 ' + randInt(50000000, 59999999),
  CH: () => '+41 ' + randInt(7, 9) + ' ' + randInt(10000000, 99999999),
  TR: () => '+90 ' + randInt(5000000000, 5999999999),
  GR: () => '+30 ' + randInt(6900000000, 6999999999),
  MD: () => '+373 ' + randInt(60000000, 79999999),
  UA: () => {
    // Мобільні (3 цифри код) і міські (2-3 цифри код), всього 9 цифр після +380
    const mob = Math.random() < 0.7;
    if (mob) {
      const code = pick(['44','67','97','50','63','98','99','73','93','95','66','68']);
      return '+380 ' + code + ' ' + randInt(1000000, 9999999);
    }
    const code = pick(['32','342','372','322','362','3522','382']);
    const rest = 9 - code.length;
    const max = Math.pow(10, rest) - 1;
    const min = Math.pow(10, rest - 1);
    return '+380 ' + code + ' ' + randInt(min, max);
  },
};

function genPostcode(country){
  switch(country){
    case 'DE': case 'FR': case 'IT': case 'ES': return randInt(10000, 99999).toString();
    case 'PL': return randInt(10,99)+'-'+randInt(100,999);
    case 'NL': return randInt(1000,9999)+' '+pick(['AB','BC','CD','DE','EF']);
    case 'GB': return pick(['SW','NW','SE','EC','WC','M','B','L'])+randInt(1,99)+' '+randInt(1,9)+pick(['AB','CD','EF']);
    case 'AT': case 'CH': case 'BE': case 'DK': return randInt(1000,9999).toString();
    case 'PT': return randInt(1000,9999)+'-'+randInt(100,999);
    case 'SE': case 'NO': return randInt(100,999)+' '+randInt(10,99);
    case 'TR': return randInt(10000,99999).toString();
    case 'UA': return randInt(10000,99999).toString();
    default: return randInt(10000,99999).toString();
  }
}

// Списки міст і вулиць
const cities = {
  DE: ['Frankfurt am Main','München','Berlin','Hamburg','Köln','Stuttgart','Düsseldorf','Leipzig','Hannover','Nürnberg','Dortmund','Bremen','Essen','Dresden','Mannheim'],
  PL: ['Warszawa','Kraków','Wrocław','Poznań','Gdańsk','Łódź','Lublin','Katowice','Białystok','Rzeszów','Szczecin','Bydgoszcz'],
  CZ: ['Praha','Brno','Ostrava','Plzeň','Liberec','Olomouc','Hradec Králové'],
  SK: ['Bratislava','Košice','Prešov','Žilina','Banská Bystrica','Nitra','Trnava'],
  HU: ['Budapest','Debrecen','Szeged','Miskolc','Pécs','Győr','Nyíregyháza'],
  AT: ['Wien','Graz','Linz','Salzburg','Innsbruck','Klagenfurt'],
  NL: ['Rotterdam','Amsterdam','Eindhoven','Utrecht','Den Haag','Tilburg','Groningen'],
  BE: ['Brussels','Antwerpen','Gent','Liège','Brugge','Namur'],
  FR: ['Paris','Lyon','Marseille','Toulouse','Nice','Nantes','Strasbourg','Bordeaux','Lille','Rennes'],
  IT: ['Milano','Roma','Torino','Bologna','Verona','Napoli','Firenze','Genova','Padova','Brescia'],
  ES: ['Madrid','Barcelona','Valencia','Sevilla','Zaragoza','Bilbao','Murcia','Málaga'],
  PT: ['Lisboa','Porto','Braga','Coimbra','Aveiro'],
  GB: ['London','Manchester','Birmingham','Liverpool','Leeds','Glasgow','Sheffield','Bristol','Newcastle'],
  IE: ['Dublin','Cork','Galway','Limerick'],
  SE: ['Stockholm','Göteborg','Malmö','Uppsala','Västerås'],
  NO: ['Oslo','Bergen','Trondheim','Stavanger'],
  FI: ['Helsinki','Tampere','Turku','Espoo'],
  DK: ['København','Aarhus','Odense','Aalborg'],
  RO: ['Bucureşti','Cluj-Napoca','Timişoara','Iaşi','Constanţa','Braşov','Sibiu','Oradea'],
  BG: ['Sofia','Plovdiv','Varna','Burgas','Ruse'],
  HR: ['Zagreb','Split','Rijeka','Osijek','Zadar'],
  SI: ['Ljubljana','Maribor','Celje','Koper'],
  LT: ['Vilnius','Kaunas','Klaipėda','Šiauliai'],
  LV: ['Riga','Daugavpils','Liepāja'],
  EE: ['Tallinn','Tartu','Narva','Pärnu'],
  CH: ['Zürich','Genève','Basel','Lausanne','Bern'],
  TR: ['Istanbul','Ankara','Izmir','Bursa','Antalya','Adana','Konya','Gaziantep'],
  GR: ['Athens','Thessaloniki','Patras','Larissa'],
  MD: ['Chișinău','Bălți','Tiraspol'],
  UA: ['Львів','Київ','Одеса','Харків','Дніпро','Запоріжжя','Івано-Франківськ','Чернівці','Луцьк','Тернопіль','Рівне','Хмельницький','Вінниця','Ужгород','Полтава','Кременчук','Біла Церква','Житомир','Чернігів'],
};

const streetPatterns = {
  DE: ['{X}straße {N}', '{X}weg {N}', 'Industriestraße {N}', 'Hauptstraße {N}', 'Bahnhofstraße {N}', 'Schulstraße {N}'],
  PL: ['ul. {X}skiego {N}', 'ul. Przemysłowa {N}', 'ul. {X}wska {N}', 'al. {X} {N}'],
  CZ: ['{X}ova {N}', 'Náměstí {X} {N}', '{X}ská {N}'],
  SK: ['{X}ova {N}', 'Hlavná {N}', 'Štúrova {N}'],
  HU: ['{X} utca {N}', 'Fő utca {N}', 'Kossuth Lajos utca {N}'],
  AT: ['{X}straße {N}', 'Hauptplatz {N}', '{X}gasse {N}'],
  NL: ['{X}straat {N}', '{X}laan {N}', '{X}weg {N}'],
  BE: ['Rue de {X} {N}', 'Avenue {X} {N}', 'Chaussée de {X} {N}'],
  FR: ['Rue de {X} {N}', 'Avenue {X} {N}', 'Boulevard {X} {N}'],
  IT: ['Via {X} {N}', 'Corso {X} {N}', 'Viale {X} {N}'],
  ES: ['Calle {X} {N}', 'Avenida {X} {N}', 'Paseo de {X} {N}'],
  PT: ['Rua {X} {N}', 'Avenida {X} {N}'],
  GB: ['{N} {X} Street', '{N} {X} Road', '{N} {X} Avenue', '{N} {X} Lane'],
  IE: ['{N} {X} Street', '{X} Road {N}'],
  SE: ['{X}gatan {N}', '{X}vägen {N}'],
  NO: ['{X}gata {N}', '{X}veien {N}'],
  FI: ['{X}katu {N}', '{X}tie {N}'],
  DK: ['{X}gade {N}', '{X}vej {N}'],
  RO: ['Strada {X} {N}', 'Bulevardul {X} {N}', 'Calea {X} {N}'],
  BG: ['ul. {X} {N}', 'bul. {X} {N}'],
  HR: ['{X}ova {N}', '{X}ulica {N}'],
  SI: ['{X}ulica {N}', '{X}cesta {N}'],
  LT: ['{X}gatvė {N}', '{X}prospektas {N}'],
  LV: ['{X}iela {N}'],
  EE: ['{X} tänav {N}'],
  CH: ['{X}strasse {N}', 'Rue {X} {N}'],
  TR: ['{X} Cd. {N}', '{X} Sk. {N}', '{X} Bulvarı {N}'],
  GR: ['{X} {N}', 'Leoforos {X} {N}'],
  MD: ['Str. {X} {N}', 'bd. {X} {N}'],
  UA: ['вул. {X} {N}', 'проспект {X} {N}', 'бульвар {X} {N}'],
};

const streetSamples = {
  DE: ['Industrie','Bahnhof','Schul','Kirchen','Markt','Lager','Werk','Mühlen','Park','Garten','Wiesen','Berg','Wald','Süd','Nord','Ost','West','Wiener','Berliner','Hafen','Hamburger','Münchner','Adler','Falken','Stern','Sonnen','Mond','Rosen','Linden','Tannen','Birken','Eichen','Beethoven','Schiller','Goethe','Mozart','Kant'],
  AT: ['Industrie','Bahnhof','Haupt','Wiener','Schiller','Mozart','Beethoven','Wald','Berg','Sonnen','Mariahilfer','Kärntner','Burggasse','Stein'],
  CH: ['Industrie','Bahnhof','Haupt','Stein','Berg','Garten','Wald','Sonnen','Berner','Zürcher','Basler','Bahnhof','See'],
  PL: ['Przemysłowa','Krakowska','Lwowska','Warszawska','Lubelska','Słowackiego','Mickiewicza','Sienkiewicza','Kopernika','Sobieskiego','Piłsudskiego','Wilanowska','Mariacka','Floriańska','Rynkowa','Główna','Szkolna','Polna','Lipowa','Sosnowa','Klonowa','Brzozowa','Wrocławska','Poznańska','Świętojańska'],
  CZ: ['Hlavní','Národní','Pražská','Brněnská','Karlova','Husova','Komenského','Smetanova','Dvořákova','Masarykova','Wenceslas','Náměstí','Vinohradská','Spálená'],
  SK: ['Hlavná','Štúrova','Mlynská','Bratislavská','Košická','Slovenská','Námestie','Hviezdoslavova','Dunajská'],
  HU: ['Fő','Kossuth Lajos','Petőfi Sándor','Rákóczi','Bartók Béla','Andrássy','Váci','Aranyhomok','Dózsa György','Béke','Szabadság'],
  NL: ['Hoofd','Industrie','Schoolweg','Kerk','Markt','Lange','Korte','Molen','Tuin','Park','Wilhelmina','Beatrix','Rembrandt','Amsterdam','Rotterdam','Dorps'],
  BE: ['de la Gare','de la Loi','Royale','Centrale','Industrielle','de Belgique','Léopold','Saint-Pierre','Anspach','Stéphanie','Louise'],
  FR: ['de la République','de Paris','Victor Hugo','Émile Zola','Jean Jaurès','Pasteur','Voltaire','Charles de Gaulle','de la Paix','des Champs','du Commerce','Industrielle','Saint-Michel','Saint-Pierre'],
  IT: ['Roma','Garibaldi','Mazzini','Cavour','Verdi','Dante','Manzoni','Leonardo','Vittorio Emanuele','della Repubblica','Nazionale','del Commercio','Industriale','Marconi'],
  ES: ['Mayor','Real','Gran Vía','de la Constitución','de Madrid','de Barcelona','de Cervantes','de Colón','Industrial','del Comercio','de la Paz','de la Libertad','Velázquez','Goya'],
  PT: ['da República','do Comércio','Almirante Reis','da Liberdade','do Brasil','Augusta','do Carmo','Industrial'],
  GB: ['High','Park','Church','Mill','Station','Industrial','Main','King','Queen','Victoria','Cromwell','Wellington','Oxford','Cambridge','Market'],
  IE: ['Main','High','Church','Market','Connolly','Pearse','OConnell','Grafton','Castle'],
  SE: ['Storgatan','Kungsgatan','Drottninggatan','Industrigatan','Vasagatan','Linnégatan','Skolgatan','Strandvägen','Karlavägen'],
  NO: ['Karl Johans','Storgaten','Industrigaten','Kirkeveien','Skolegate','Strandveien'],
  FI: ['Mannerheim','Aleksanterin','Industri','Koulu','Keskuskatu','Rauta','Helsingin'],
  DK: ['Hovedgade','Industrivej','Strøget','Skolegade','Vesterbrogade','Nørrebrogade'],
  RO: ['Republicii','Independenței','Unirii','Decebal','Ștefan cel Mare','Mihai Viteazu','Carol I','Bulevardul Eroilor','Industriei','Calea Victoriei','Calea Moșilor'],
  BG: ['Tsar Boris III','Vitosha','Maria Luiza','Aleksandrovska','Industrialna','Pirotska'],
  HR: ['Ilica','Petrinjska','Frankopanska','Industrijska','Glavna','Tomislavova','Vukovarska'],
  SI: ['Slovenska','Trubarjeva','Industrijska','Glavna','Mariborska','Ljubljanska'],
  LT: ['Gedimino','Pilies','Vilniaus','Laisvės','Industrijos','Pramonės','Kauno','Aušros'],
  LV: ['Brīvības','Krišjāņa Barona','Tērbatas','Industrijas','Aleksandra Čaka'],
  EE: ['Tartu','Pärnu','Liivalaia','Tööstuse','Narva','Estonia','Suur-Tallinna'],
  TR: ['Atatürk','İstiklal','Cumhuriyet','Bağdat','Barbaros','İnönü','Gazi','Sanayi','Bağlar','Çiçek','Lale'],
  GR: ['Ermou','Stadiou','Panepistimiou','Akadimias','Patission','Vasilissis Sofias','Athinas'],
  MD: ['Ștefan cel Mare','Mihai Eminescu','Industrială','Pușkin','București'],
  UA: ['Шевченка','Грушевського','Бандери','Незалежності','Промислова','Логістична','Складська','Зелена','Городоцька','Стрийська','Замарстинівська','Хмельницького','Виговського','Сахарова','Чорновола','Героїв Майдану','Соборна','Київська','Львівська'],
};

function street(country){
  const patterns = streetPatterns[country] || streetPatterns.DE;
  const p = pick(patterns);
  const samples = streetSamples[country] || streetSamples.DE;
  const x = pick(samples);
  const n = randInt(1, 250);
  return p.replace('{X}', x).replace('{N}', n);
}

// Імена + прізвища
const names = {
  DE: { first:['Andreas','Klaus','Werner','Stefan','Michael','Thomas','Jürgen','Wolfgang','Hans','Peter','Frank','Markus','Bernd','Karl','Manfred','Sabine','Petra','Monika','Andrea','Susanne'],
        last:['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann','Koch','Bauer','Klein','Wolf','Schröder','Neumann','Schwarz','Zimmermann']},
  PL: { first:['Tomasz','Krzysztof','Marcin','Piotr','Paweł','Andrzej','Michał','Jakub','Adam','Marek','Mateusz','Łukasz','Agnieszka','Anna','Magdalena'],
        last:['Kowalski','Wójcik','Lewandowski','Nowak','Wiśniewski','Dąbrowski','Kamiński','Zieliński','Szymański','Kozłowski']},
  CZ: { first:['Pavel','Petr','Jan','Jiří','Tomáš','Michal','Lukáš','Karel'],
        last:['Novák','Svoboda','Novotný','Dvořák','Černý','Procházka']},
  SK: { first:['Peter','Martin','Tomáš','Ján','Michal','Lukáš'],
        last:['Horváth','Kováč','Varga','Tóth','Nagy','Szabó']},
  HU: { first:['László','István','József','János','Zoltán','Sándor','Ferenc','Gábor'],
        last:['Nagy','Kovács','Tóth','Szabó','Horváth','Varga','Kiss','Molnár']},
  AT: { first:['Wolfgang','Stefan','Klaus','Michael','Thomas','Andreas'],
        last:['Gruber','Huber','Bauer','Wagner','Müller','Schmid']},
  NL: { first:['Jan','Pieter','Hans','Mark','Bart','Peter','Erik'],
        last:['de Vries','van Dijk','Bakker','Janssen','Visser','Smit','Meijer','de Boer','Mulder','de Groot','Bos']},
  BE: { first:['Lucas','Lars','Noah','Mathieu','Antoine'],
        last:['Peeters','Janssens','Maes','Jacobs','Mertens','Willems','Claes','Goossens']},
  FR: { first:['Jean','Pierre','Michel','Philippe','Alain','Nicolas','Christophe','Olivier','Patrick','François'],
        last:['Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Moreau']},
  IT: { first:['Marco','Andrea','Luca','Stefano','Giuseppe','Roberto','Paolo','Giovanni','Antonio','Francesco'],
        last:['Rossi','Russo','Ferrari','Esposito','Bianchi','Romano','Colombo','Ricci','Marino','Greco']},
  ES: { first:['José','Antonio','Manuel','Francisco','Juan','David','Javier','Carlos','Jesús','Daniel'],
        last:['García','Rodríguez','González','Fernández','López','Martínez','Sánchez','Pérez','Gómez','Martín']},
  PT: { first:['João','António','Manuel','Francisco','Carlos','José'],
        last:['Silva','Santos','Ferreira','Pereira','Oliveira','Costa']},
  GB: { first:['James','John','David','Michael','Robert','William','Andrew','Paul','Mark','Stephen'],
        last:['Smith','Jones','Williams','Brown','Taylor','Davies','Wilson','Evans','Thomas','Roberts']},
  IE: { first:['Sean','Patrick','Conor','Liam','Ciaran'],
        last:["O'Brien","Murphy","O'Sullivan","Walsh","Kelly","Byrne"]},
  SE: { first:['Erik','Lars','Anders','Per','Magnus','Mikael','Johan','Karl'],
        last:['Andersson','Johansson','Karlsson','Nilsson','Eriksson','Larsson','Olsson','Persson']},
  NO: { first:['Lars','Erik','Knut','Jan','Per','Ole'],
        last:['Hansen','Olsen','Larsen','Andersen','Nilsen','Berg']},
  FI: { first:['Mika','Jari','Antti','Pekka','Markku'],
        last:['Korhonen','Virtanen','Mäkinen','Nieminen','Mäkelä']},
  DK: { first:['Lars','Peter','Michael','Jens','Henrik'],
        last:['Nielsen','Jensen','Hansen','Pedersen','Andersen','Christensen']},
  RO: { first:['Andrei','Mihai','Cristian','Adrian','Alexandru','Florin','Gabriel','Ion','Ștefan','Marius'],
        last:['Popescu','Ionescu','Popa','Constantinescu','Dumitrescu','Stoica','Stan','Gheorghiu','Munteanu','Radu']},
  BG: { first:['Georgi','Ivan','Dimitar','Stoyan','Nikolay','Petar'],
        last:['Petrov','Ivanov','Dimitrov','Georgiev','Stoyanov','Nikolov']},
  HR: { first:['Marko','Ivan','Luka','Josip','Tomislav'],
        last:['Horvat','Kovačević','Marković','Babić','Jurić']},
  SI: { first:['Andrej','Marko','Janez','Matej'],
        last:['Novak','Horvat','Kovačič','Krajnc','Zupančič']},
  LT: { first:['Tomas','Mantas','Darius','Vytautas','Rimas','Algis','Arūnas'],
        last:['Kazlauskas','Petrauskas','Jankauskas','Stankevičius','Vasiliauskas']},
  LV: { first:['Jānis','Andris','Māris','Edgars'],
        last:['Bērziņš','Kalniņš','Ozoliņš','Liepiņš']},
  EE: { first:['Mart','Andres','Toomas','Rein'],
        last:['Kask','Tamm','Saar','Mägi']},
  CH: { first:['Hans','Peter','Daniel','Marco','Stefan'],
        last:['Müller','Meier','Schmid','Keller','Weber']},
  TR: { first:['Mehmet','Mustafa','Ali','Hüseyin','Hasan','İbrahim','İsmail','Osman','Yusuf'],
        last:['Yılmaz','Demir','Kaya','Şahin','Çelik','Yıldız','Yıldırım','Öztürk','Aydın','Özdemir']},
  GR: { first:['Giorgos','Nikos','Dimitris','Yannis','Kostas'],
        last:['Papadopoulos','Nikolaou','Georgiou','Dimitriou','Papageorgiou']},
  MD: { first:['Ion','Mihail','Vasile','Dumitru'],
        last:['Popescu','Rusu','Cebotari','Lupu']},
  UA: { first:['Сергій','Микола','Олександр','Петро','Іван','Володимир','Олег','Дмитро','Андрій','Богдан','Максим','Юрій','Тарас','Роман','Василь','Михайло','Анатолій','Ярослав','Ігор','Денис','Олена','Тетяна','Ірина','Оксана','Наталія','Катерина'],
        last:['Гнатюк','Бойко','Коваленко','Шевченко','Мельник','Кравчук','Іваненко','Петренко','Стефанюк','Гриценко','Ткаченко','Бондаренко','Кравець','Олійник','Дяченко','Захарчук','Романюк','Литвин','Гончар','Сидоренко','Левченко','Тимченко','Юрченко','Демчук','Сердюк']},
};

// Бізнес-суфікси і шаблони назв
const suffixes = {
  DE: ['GmbH','GmbH & Co. KG','AG','UG','OHG','e.K.'],
  PL: ['Sp. z o.o.','S.A.','Sp.j.','Sp.k.','PHU'],
  CZ: ['s.r.o.','a.s.','spol. s r.o.'],
  SK: ['s.r.o.','a.s.','k.s.'],
  HU: ['Kft.','Zrt.','Bt.','Nyrt.'],
  AT: ['GmbH','AG','OG','KG'],
  NL: ['B.V.','N.V.','V.O.F.'],
  BE: ['BVBA','NV','SPRL','SA'],
  FR: ['SARL','SAS','SA','EURL'],
  IT: ['S.p.A.','S.r.l.','S.n.c.','S.a.s.'],
  ES: ['S.L.','S.A.','S.L.U.'],
  PT: ['Lda.','S.A.','Unipessoal Lda.'],
  GB: ['Ltd','PLC','LLP'],
  IE: ['Ltd','PLC','DAC'],
  SE: ['AB','HB','KB'],
  NO: ['AS','ASA','ANS'],
  FI: ['Oy','Oyj','Ky'],
  DK: ['A/S','ApS','I/S'],
  RO: ['SRL','SA','SCS'],
  BG: ['EOOD','OOD','AD'],
  HR: ['d.o.o.','d.d.','j.d.o.o.'],
  SI: ['d.o.o.','d.d.','s.p.'],
  LT: ['UAB','AB','MB'],
  LV: ['SIA','AS','IK'],
  EE: ['OÜ','AS','MTÜ'],
  CH: ['AG','GmbH','SA','S.à r.l.'],
  TR: ['A.Ş.','Ltd. Şti.','LLC'],
  GR: ['A.E.','E.P.E.','O.E.'],
  MD: ['SRL','SA'],
  UA: ['ТОВ','ПП','ФОП','ПрАТ','ТзОВ'],
};

const businessNouns = ['Logistik','Cargo','Trans','Spedition','Transport','Fracht','Forwarding','Shipping','Logistics','Group','Trading','Industries','Manufacturing','Distribution','Solutions','Services','Express','International'];

// UA — реалістичні назви бізнесів за галузями
const uaCompanyNames = [
  // Агро
  'Карпатський Агро','Зерноекспорт','Українська Олія','Соняшник-Експорт','Поділля-Агро','АгроТрейд Україна','Зерно-Імпекс','Полтавський АПК','АгроПродукт','Степова Нива',
  // Меблі
  'Карпатські Меблі','Лісовий Дім','Дубовий Двір','Меблі Захід','Світлий Дім','Затишок Меблі','Львівська Меблева Фабрика','Прикарпатські Меблі','Європейський Стиль',
  // Текстиль / одяг
  'Львівський Текстиль','Українська Шкіра','Чернівецький Швейний','Текстиль-Україна','Карпатська Сорочка','Одяг-Експорт','UkraineFashion','LWG Textile',
  // Електроніка / IT-гаджети
  'Електро-Захід','UkrTech Manufacturing','Інженерні Рішення','TechProduct UA','ЛьвівЕлектро','Полтава Електроніка',
  // Металовироби / машинобуд
  'Метал-Україна','Захід-Інструмент','Карпатський Метал','Точпром','Київський Машзавод','Дніпрометал','Сталь-Експорт',
  // Харчова
  'Молочна Долина','Карпатський Сир','Кондитер-Експорт','Українська Кава','Львівські Цукерки','Свіжак','Натурпродукт','Карпатський Мед',
  // Будматеріали
  'УкрБуд','Львівбудматеріал','Карпатський Камінь','Цегла Захід','БудМатеріал-Експорт','Деревообробка Захід',
  // Хімія / Pharma
  'УкрХім','Львівхім','Фарма-Експорт','Захід-Фарм','Косметика України',
  // Логістика / транспортні / трейд
  'Захід-Трейд','Karpathia Group','UA-Export','Транс-Імпекс','Карпатський Логістик','UkrLogistics','Western Trade UA','EuroUkraine',
  // IT
  'SoftServ UA','IT-Захід','Digital Ukraine',
  // Інше
  'Європейські Двері','Українські Стандарти','Захід-Імпорт','Зернотрейд','Спецтехніка-Захід','Адамант UA','Олімп-Експорт','Бескид Трейд'
];

function genCompanyName(country, lastName, firstName){
  // ── UA — особлива форма «ТОВ Назва» / «ФОП Прізвище І.П.» ──
  if (country === 'UA') {
    const suf = pick(suffixes.UA);
    if (suf === 'ФОП') {
      const initial = firstName ? `${firstName[0]}.${lastName[0]}.` : pick(['С.І.','М.П.','А.В.','Д.О.','В.І.','П.С.','О.В.','Р.М.']);
      return `ФОП ${lastName} ${initial}`;
    }
    return `${suf} «${pick(uaCompanyNames)}»`;
  }

  const useSurname = Math.random() < 0.35;
  const suf = pick(suffixes[country] || ['Ltd']);
  if (useSurname) {
    return `${lastName} ${pick(businessNouns)} ${suf}`;
  }
  const noun1 = pick(businessNouns);
  const noun2 = pick([pick(businessNouns), pick(cities[country] || ['Euro']), 'Euro', 'Global', 'United', 'Royal', 'Prime', 'Top']);
  return `${noun2}-${noun1} ${suf}`;
}

function emailFromCompany(company, country){
  const tld = {DE:'de',PL:'pl',CZ:'cz',SK:'sk',HU:'hu',AT:'at',NL:'nl',BE:'be',FR:'fr',IT:'it',ES:'es',PT:'pt',GB:'co.uk',IE:'ie',SE:'se',NO:'no',FI:'fi',DK:'dk',RO:'ro',BG:'bg',HR:'hr',SI:'si',LT:'lt',LV:'lv',EE:'ee',CH:'ch',TR:'com.tr',GR:'gr',MD:'md',UA:'com.ua'}[country]||'eu';

  // Транслітерація національних літер
  const translit = {
    // Кирилиця (для UA)
    'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya',
    'А':'a','Б':'b','В':'v','Г':'h','Ґ':'g','Д':'d','Е':'e','Є':'ye','Ж':'zh','З':'z','И':'y','І':'i','Ї':'yi','Й':'y','К':'k','Л':'l','М':'m','Н':'n','О':'o','П':'p','Р':'r','С':'s','Т':'t','У':'u','Ф':'f','Х':'kh','Ц':'ts','Ч':'ch','Ш':'sh','Щ':'shch','Ь':'','Ю':'yu','Я':'ya',
    // EU літери
    'ä':'ae','ö':'oe','ü':'ue','ß':'ss',
    'á':'a','à':'a','â':'a','ã':'a',
    'é':'e','è':'e','ê':'e','ë':'e',
    'í':'i','ì':'i','î':'i','ï':'i',
    'ó':'o','ò':'o','ô':'o','õ':'o',
    'ú':'u','ù':'u','û':'u',
    'ç':'c','ñ':'n',
    'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ś':'s','ź':'z','ż':'z',
    'č':'c','ď':'d','ě':'e','ň':'n','ř':'r','š':'s','ť':'t','ů':'u','ý':'y','ž':'z',
    'ş':'s','ı':'i','ğ':'g',
    'ő':'o','ű':'u',
    'å':'a','ø':'o','æ':'ae',
    'ț':'t','ș':'s','ă':'a',
    'ī':'i','ē':'e','ā':'a','ū':'u','ļ':'l','ņ':'n','ķ':'k','ģ':'g',
    'į':'i','ų':'u','ė':'e',
  };

  let base = company.toLowerCase();
  // Для UA-компаній прибираємо префікс юрформи перед транслітом
  if (country === 'UA') {
    base = base.replace(/^(тов|тзов|прат|пп|фоп|пат|пп)\s*[«"]?/, '').replace(/[«»"]/g, '').trim();
  }
  // Покрокова транслітерація (працює і для кирилиці, і для діакритики)
  let out = '';
  for (const ch of base) {
    out += (translit[ch] !== undefined) ? translit[ch] : ch;
  }
  base = out
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .split('-').filter(s => s.length >= 2).slice(0,2).join('-');
  return `office@${base || 'company'}.${tld}`;
}

function genClient(country){
  const nm = names[country] || names.DE;
  const last = pick(nm.last);
  const first = pick(nm.first);
  const person = `${first} ${last}`;
  const company = genCompanyName(country, last, first);
  const city = pick(cities[country] || ['Berlin']);
  const postcode = genPostcode(country);
  // UA — формат адреси: "м. Львів, вул. Шевченка 12, 79000"
  // EU — формат: "Bahnhofstraße 12, 60329 Frankfurt"
  const addr = (country === 'UA')
    ? `м. ${city}, ${street(country)}, ${postcode}`
    : `${street(country)}, ${postcode} ${city}`;
  const vatGen = vat[country] || vat.DE;
  const phoneGen = phone[country] || phone.DE;
  const businessType = pick(['shipper','manufacturer','forwarder','trader']);

  return {
    id: uuidv4(),
    company,
    person,
    country,
    city,
    address: addr,
    vat_id: vatGen(),
    phone: phoneGen(),
    email: emailFromCompany(company, country),
    business_type: businessType,
    notes: '',
  };
}

// План: ~120 замовників, 70% українські (експорт з України) + 30% EU (імпорт)
// Покриваємо всі країни які є в листах
const distribution = [
  // ── UA: 77 замовників (агро, мебель, текстиль, металовироби, харчова, IT) ──
  ['UA', 77],

  // ── EU + інші: 35 замовники (мін. 1 на кожну країну з листів) ──
  ['DE', 5],
  ['PL', 4],
  ['NL', 2],
  ['IT', 3],
  ['FR', 2],
  ['CZ', 2],
  ['SK', 2],
  ['HU', 2],
  ['RO', 2],
  ['AT', 1],
  ['BE', 1],
  ['ES', 1],
  ['PT', 1],
  ['LT', 1],
  ['LV', 1],
  ['EE', 1],
  ['SE', 1],
  ['NO', 1],
  ['DK', 1],
  ['FI', 1],
  ['GB', 1],
  ['IE', 1],
  ['HR', 1],
  ['SI', 1],
  ['CH', 1],
  ['TR', 1],
  ['BG', 1],
  ['GR', 1],
  ['MD', 1],
  // Балкани і складні країни — поки беремо найближчих сусідів
  // AL, BA, MK, IR — використають фолбек через DE/TR (рідкісні листи)
];

const all = [];
for (const [country, n] of distribution) {
  for (let i = 0; i < n; i++) {
    all.push(genClient(country));
  }
}

// Заливка
const ins = db.prepare(`INSERT INTO clients (id,company,person,country,city,address,vat_id,phone,email,business_type,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insertAll = db.transaction(arr => {
  for (const c of arr) ins.run(c.id, c.company, c.person, c.country, c.city, c.address, c.vat_id, c.phone, c.email, c.business_type, c.notes);
});
insertAll(all);

console.log(`✓ Seeded ${all.length} clients`);

// Статистика
const byCountry = db.prepare("SELECT country, COUNT(*) as c FROM clients GROUP BY country ORDER BY c DESC").all();
console.log('\nРозподіл за країнами:');
byCountry.forEach(r => console.log(`  ${r.country}: ${r.c}`));

db.close();
