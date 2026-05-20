// server/utils/application-builder.js
// Генерація даних заявки (Transport Order) від замовника.
// Розподіл варіантів: 40% повна вкладенням, 40% повна текстом,
//                     10% неповна вкладенням, 10% неповна текстом.

// Реквізити Docaa (наш експедитор)
const DOCAA_DETAILS = {
  company: 'Docaa LLC',
  address: 'м. Івано-Франківськ, вул. Української Дивізії 27',
  vat_id: 'ЄДРПОУ 37794411',
  phone: '+380 342 26 07 42',
};

// 4 типи пропусків для incomplete варіанту
const MISSING_FIELD_TYPES = [
  'customs',       // адреси митниці (замитнення або розмитнення)
  'weight',        // вага
  'pallets',       // розмір/кількість палет
  'load_date',     // дата завантаження
];

function pickVariant(){
  const r = Math.random();
  if (r < 0.40) return 'attachment';            // 40%
  if (r < 0.80) return 'text';                   // 40%
  if (r < 0.90) return 'incomplete_attachment';  // 10%
  return 'incomplete_text';                      // 10%
}

function pickMissingFields(){
  // 1-2 поля з 4 типів
  const count = Math.random() < 0.6 ? 1 : 2;
  const shuffled = [...MISSING_FIELD_TYPES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Розподіл сценаріїв авто/водія:
//   60% — замовник питає перед заявкою → у заявці є
//   30% — питає на наступний день
//   10% — питає в той самий день після заявки
function pickVehicleScenario(){
  const r = Math.random();
  if (r < 0.60) return 'asked_before';     // ТЗ є в заявці
  if (r < 0.90) return 'ask_next_day';     // питає завтра
  return 'ask_same_day';                    // питає сьогодні
}

// Генерація номера заявки
function genOrderNumber(simulationDate){
  // simulationDate у форматі 'DD.MM.YYYY' або Date
  let d;
  if (typeof simulationDate === 'string' && simulationDate.includes('.')) {
    const [dd,mm,yyyy] = simulationDate.split('.').map(Number);
    d = new Date(yyyy, mm-1, dd);
  } else if (simulationDate instanceof Date) {
    d = simulationDate;
  } else {
    d = new Date();
  }
  const y = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const seq = String(Math.floor(Math.random()*900) + 100); // 100-999
  return `TR-${y}-${mm}${dd}-${seq}`;
}

// Парсимо домовлену ціну з переписки.
// Шукаємо останнє підтвердження ціни — або від замовника, або від студента.
function extractAgreedPrice(messages){
  // Шукаємо числа з валютою у останніх 10 повідомленнях
  const last = messages.slice(-10);
  const prices = [];
  for (const m of last) {
    const text = m.text || m.content || '';
    // Шукаємо: €1200, 1200 EUR, 1200€, 1200 евро, 1200 eur
    const matches = text.matchAll(/(?:€|EUR\s*|euro?\s*)(\d[\d\s,.]*\d|\d)|(\d[\d\s,]*\d|\d)\s*(?:€|EUR|euro?)/gi);
    for (const m of matches) {
      const num = (m[1] || m[2] || '').replace(/[\s,]/g,'');
      const n = parseFloat(num);
      if (n >= 100 && n <= 20000) prices.push(n);
    }
  }
  if (!prices.length) return null;
  // Беремо останню згадану ціну — імовірно це фінальна
  return prices[prices.length - 1];
}

// Збирає структурований JSON заявки з letter + переписки + контексту
function buildApplicationData({ letter, client, messages, simulationDate, vehicleScenario }){
  const agreedPrice = extractAgreedPrice(messages || []);

  // Дати: завантаження з листа (load_day_offset) або з контексту
  let loadDateStr = '';
  if (letter.load_day_offset && simulationDate) {
    try {
      const [dd,mm,yyyy] = simulationDate.split('.').map(Number);
      const start = new Date(yyyy, mm-1, dd);
      start.setDate(start.getDate() + (letter.load_day_offset || 4));
      loadDateStr = `${String(start.getDate()).padStart(2,'0')}.${String(start.getMonth()+1).padStart(2,'0')}.${start.getFullYear()}`;
    } catch(e){ loadDateStr = ''; }
  }

  // Тип авто — додаємо температуру для Реф
  const vehicleType = pickVehicleTypeWithTemp(letter.vehicle || 'Тент', letter.cargo_description || '');

  // Пункт перетину — обирається з контексту маршруту
  const crossingPoint = pickCrossingPoint(letter.dirs);

  const data = {
    order_number: genOrderNumber(simulationDate),
    order_date: simulationDate || '',

    // Сторони
    client: client ? {
      company: client.company,
      person: client.person,
      address: client.address,
      vat_id: client.vat_id,
      phone: client.phone,
    } : null,
    docaa: { ...DOCAA_DETAILS },

    // Транспорт
    vehicle: vehicleType,
    vehicle_requirements: '',

    // Вантаж
    cargo: {
      description: letter.cargo_description || '',
      weight_kg: letter.cargo_weight_kg || null,
      volume_m3: letter.cargo_volume_m3 || null,
      pallets: letter.cargo_pallets || null,
    },

    // Завантаження
    loading: {
      date: loadDateStr,
      time_window: pickTimeWindow(),
      address: letter.load_address || '',
      contact_name: letter.load_contact_name || '',
      contact_phone: letter.load_contact_phone || '',
    },

    // Митниці
    customs_out: letter.customs_out_address || '',
    customs_in: letter.customs_in_address || '',

    // Пункт перетину кордону
    crossing_point: crossingPoint,

    // Розвантаження
    unloading: {
      date: '',
      address: letter.unload_address || '',
      contact_name: letter.unload_contact_name || '',
      contact_phone: letter.unload_contact_phone || '',
    },

    // Фрахт
    freight: {
      amount_eur: agreedPrice,
      payment_terms: pickPaymentTerms(),
    },

    // Авто/водій — за PDF діалогами замовник ЗАВЖДИ залишає ці поля порожніми
    // студент вписує сам після того як домовиться з перевізником
    vehicle_data: {
      plate: '',
      driver_name: '',
      driver_phone: '',
    },
  };

  return data;
}

// Тип авто з температурою для рефів
function pickVehicleTypeWithTemp(vehicle, cargoDescription){
  if (!/реф|ізотерм/i.test(vehicle)) return vehicle;

  // Для рефів обираємо температуру за типом вантажу
  const cargo = (cargoDescription || '').toLowerCase();

  // М'ясо, риба, морепродукти, заморожене — глибока заморозка
  if (/м['я]ясо|риб|морепродукт|заморож|ягоди|випіч|пельмен/i.test(cargo)) {
    return vehicle + ' -18';
  }
  // Молочка, сир, шоколад, кондитерка — холод
  if (/молоч|сир|шоколад|кондитер|йогурт|вершки/i.test(cargo)) {
    return vehicle + ' -10';
  }
  // Свіже м'ясо охолоджене
  if (/м['я]ясо охолоджен/i.test(cargo)) {
    return vehicle + ' -15';
  }
  // За замовчуванням -10 для рефа
  return vehicle + ' -10';
}

// Пункт перетину кордону
function pickCrossingPoint(dirsJson){
  let dirs = [];
  try { dirs = typeof dirsJson === 'string' ? JSON.parse(dirsJson) : (dirsJson || []); } catch(e){}

  const from = dirs[0];
  const to = dirs[dirs.length-1];

  // Для UA <-> EU: пункти перетину з/в Україну
  const isUaInvolved = from === 'UA' || to === 'UA';
  if (!isUaInvolved) return '';

  // Інший бік (не UA)
  const other = from === 'UA' ? to : from;

  // Пункти за регіонами
  const polishBorder = ['Шегині', 'Краківець', 'Рава-Руська', 'Грушів'];     // UA-PL
  const slovakBorder = ['Ужгород', 'Малі Селменці'];                          // UA-SK
  const hungarBorder = ['Чоп', 'Лужанка'];                                    // UA-HU
  const romanianBorder = ['Порубне', 'Дякове'];                              // UA-RO
  const moldovaBorder = ['Могилів-Подільський', 'Кучурган'];                  // UA-MD

  // Маршрутизація: для країни визначаємо ймовірний пункт
  const byCountry = {
    PL: polishBorder,
    DE: polishBorder, NL: polishBorder, BE: polishBorder, FR: polishBorder,
    GB: polishBorder, IE: polishBorder, ES: polishBorder, PT: polishBorder,
    DK: polishBorder, SE: polishBorder, NO: polishBorder, FI: polishBorder,
    EE: polishBorder, LT: polishBorder, LV: polishBorder,
    SK: slovakBorder, CZ: slovakBorder, AT: slovakBorder, CH: slovakBorder,
    HU: hungarBorder, SI: hungarBorder, HR: hungarBorder, IT: hungarBorder,
    RO: romanianBorder, BG: romanianBorder, GR: romanianBorder, TR: romanianBorder,
    MD: moldovaBorder,
  };
  const pool = byCountry[other] || polishBorder;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickTimeWindow(){
  const opts = ['08:00-12:00', '09:00-14:00', '08:00-16:00', '07:00-11:00', '13:00-17:00'];
  return opts[Math.floor(Math.random() * opts.length)];
}

function pickPaymentTerms(){
  const opts = [
    '14 днів після CMR + рахунок',
    '30 днів після CMR + рахунок',
    '21 день після розвантаження',
    '45 днів після CMR',
    'Передплата 30% + 70% після розвантаження',
  ];
  return opts[Math.floor(Math.random() * opts.length)];
}

// Застосовує пропуски до даних (для incomplete варіантів)
function applyMissingFields(data, missingFields){
  for (const field of missingFields) {
    switch (field) {
      case 'customs':
        // Один з двох — зробимо undefined для AI
        if (Math.random() < 0.5) data.customs_out = '';
        else data.customs_in = '';
        break;
      case 'weight':
        data.cargo.weight_kg = null;
        break;
      case 'pallets':
        data.cargo.pallets = null;
        data.cargo.volume_m3 = null;
        break;
      case 'load_date':
        data.loading.date = '';
        break;
    }
  }
  return data;
}

module.exports = {
  pickVariant,
  pickMissingFields,
  pickVehicleScenario,
  buildApplicationData,
  applyMissingFields,
  extractAgreedPrice,
  DOCAA_DETAILS,
};
