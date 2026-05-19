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
    vehicle: letter.vehicle || 'Тент',
    vehicle_requirements: '',  // AI може додати

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

    // Розвантаження
    unloading: {
      date: '',  // зазвичай вказують "+2 дні від завантаження"
      address: letter.unload_address || '',
      contact_name: letter.unload_contact_name || '',
      contact_phone: letter.unload_contact_phone || '',
    },

    // Фрахт
    freight: {
      amount_eur: agreedPrice,
      payment_terms: pickPaymentTerms(),
    },

    // Авто/водій — заповнюється тільки якщо сценарій 'asked_before'
    vehicle_data: vehicleScenario === 'asked_before' ? {
      plate: '— уточнюється —',
      driver_name: '— уточнюється —',
      driver_phone: '— уточнюється —',
    } : null,
  };

  return data;
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
