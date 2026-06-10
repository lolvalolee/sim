// server/utils/application-validator.js
// Валідація форми заявки проти того що було підтверджено у переписці.
// Повертає масив warnings — НЕ блокує збереження, тільки попереджає.
//
// Правила:
// 1. Фрахт замовника = підтвердженому з замовником (точно, без округлень)
// 2. Фрахт перевізника = підтвердженому з перевізником (точно, без округлень)
// 3. Маршрут (країни) = маршрут листа
// 4. Дата завантаження = підтвердженій даті

function validateApplication({ formData, orderProgress, letter, client, carrier }){
  const warnings = [];

  if (!formData) return warnings;

  // ── Перевірка фрахту замовника ──
  // Тільки якщо є підтвердження з замовником
  if (orderProgress && orderProgress.client_agreed_price != null && formData.client_freight != null) {
    const expected = parseFloat(orderProgress.client_agreed_price);
    const actual = parseFloat(formData.client_freight);
    if (!isNaN(expected) && !isNaN(actual) && expected !== actual) {
      warnings.push({
        field: 'client_freight',
        expected,
        actual,
        severity: 'warn',
        message: `У переписці з замовником узгоджено €${expected}. Ви вписали €${actual}.`,
      });
    }
  } else if (formData.client_freight != null && (!orderProgress || !orderProgress.client_agreed_at)) {
    // Немає підтвердження з замовником
    warnings.push({
      field: 'client_freight',
      severity: 'info',
      message: 'Угоду з замовником ще не закрито у чаті — перевірте перед надсиланням.',
    });
  }

  // ── Перевірка фрахту перевізника ──
  if (orderProgress && orderProgress.carrier_agreed_price != null && formData.carrier_freight != null) {
    const expected = parseFloat(orderProgress.carrier_agreed_price);
    const actual = parseFloat(formData.carrier_freight);
    if (!isNaN(expected) && !isNaN(actual) && expected !== actual) {
      const direction = actual < expected ? 'less' : 'more';
      if (direction === 'less') {
        // №4: занижено — перевізник незадоволений, вимагає домовлене
        warnings.push({
          field: 'carrier_freight', expected, actual, direction, severity: 'warn',
          message: `Перевізник: у заявці фрахт €${actual}, а домовлялись на €${expected}. Це менше — виправте, будь ласка.`,
        });
      } else {
        // №4: завищено. Реакція залежить від надійності перевізника:
        // надійний (≥0.5, ~70%) помічає і вказує; ненадійний (<0.5) мовчки приймає зайве.
        const reliability = (carrier && carrier.reliability != null) ? carrier.reliability : 0.8;
        if (reliability >= 0.5) {
          warnings.push({
            field: 'carrier_freight', expected, actual, direction, severity: 'warn',
            message: `Перевізник: отримав вашу заявку, але ви помилились з фрахтом — вказано €${actual} замість домовлених €${expected}. Поправте, будь ласка.`,
          });
        }
        // ненадійний — без warning (мовчки бере більше; студент втрачає маржу)
      }
    }
  } else if (formData.carrier_freight != null && (!orderProgress || !orderProgress.carrier_agreed_at)) {
    warnings.push({
      field: 'carrier_freight',
      severity: 'info',
      message: 'Угоду з перевізником ще не закрито у чаті — перевірте перед надсиланням.',
    });
  }

  // ── Перевірка дати завантаження ──
  if (orderProgress && formData.load_date) {
    const expectedDate =
      orderProgress.carrier_agreed_date ||
      orderProgress.client_agreed_date ||
      null;
    if (expectedDate && expectedDate !== formData.load_date) {
      warnings.push({
        field: 'load_date',
        expected: expectedDate,
        actual: formData.load_date,
        severity: 'warn',
        message: `Узгоджена дата завантаження: ${expectedDate}. Ви вказали ${formData.load_date}.`,
      });
    }
  }

  // ── Перевірка маршруту (за країнами) ──
  if (letter && formData.load_address && formData.unload_address) {
    let dirs = [];
    try { dirs = JSON.parse(letter.dirs || '[]'); } catch(e){}
    const fromCountry = dirs[0];
    const toCountry = dirs[dirs.length-1];

    // Базова перевірка: чи у адресах згадуються правильні країни
    // (це не строга перевірка — просто базовий контроль)
    if (fromCountry && fromCountry !== toCountry) {
      const fromLower = (formData.load_address || '').toLowerCase();
      const toLower = (formData.unload_address || '').toLowerCase();
      const countryNames = countryNamesByCode(fromCountry);
      const fromMatches = countryNames.some(n => fromLower.includes(n.toLowerCase()));
      if (countryNames.length > 0 && !fromMatches) {
        warnings.push({
          field: 'load_address',
          severity: 'info',
          message: `За листом завантаження у країні ${fromCountry}. Перевірте адресу.`,
        });
      }
      const toCountryNames = countryNamesByCode(toCountry);
      const toMatches = toCountryNames.some(n => toLower.includes(n.toLowerCase()));
      if (toCountryNames.length > 0 && !toMatches) {
        warnings.push({
          field: 'unload_address',
          severity: 'info',
          message: `За листом розвантаження у країні ${toCountry}. Перевірте адресу.`,
        });
      }
    }
  }

  return warnings;
}

// Допоміжна — назви країн для матчингу адрес
function countryNamesByCode(code){
  const map = {
    UA: ['Україна', 'україна', 'Ukraine', 'UA'],
    PL: ['Польща', 'польща', 'Poland', 'Polska', 'PL'],
    DE: ['Німеччина', 'німеччина', 'Germany', 'Deutschland', 'DE'],
    NL: ['Нідерланди', 'нідерланди', 'Netherlands', 'Holland', 'NL'],
    BE: ['Бельгія', 'бельгія', 'Belgium', 'België', 'BE'],
    FR: ['Франція', 'франція', 'France', 'FR'],
    IT: ['Італія', 'італія', 'Italy', 'Italia', 'IT'],
    ES: ['Іспанія', 'іспанія', 'Spain', 'España', 'ES'],
    PT: ['Португалія', 'португалія', 'Portugal', 'PT'],
    AT: ['Австрія', 'австрія', 'Austria', 'AT'],
    CH: ['Швейцарія', 'швейцарія', 'Switzerland', 'Schweiz', 'CH'],
    CZ: ['Чехія', 'чехія', 'Czech', 'Česko', 'CZ'],
    SK: ['Словаччина', 'словаччина', 'Slovakia', 'Slovensko', 'SK'],
    HU: ['Угорщина', 'угорщина', 'Hungary', 'Magyarország', 'HU'],
    RO: ['Румунія', 'румунія', 'Romania', 'RO'],
    BG: ['Болгарія', 'болгарія', 'Bulgaria', 'BG'],
    GR: ['Греція', 'греція', 'Greece', 'GR'],
    GB: ['Великобританія', 'Британія', 'UK', 'United Kingdom', 'GB'],
    IE: ['Ірландія', 'ірландія', 'Ireland', 'IE'],
    DK: ['Данія', 'данія', 'Denmark', 'DK'],
    SE: ['Швеція', 'швеція', 'Sweden', 'Sverige', 'SE'],
    NO: ['Норвегія', 'норвегія', 'Norway', 'NO'],
    FI: ['Фінляндія', 'фінляндія', 'Finland', 'FI'],
    EE: ['Естонія', 'естонія', 'Estonia', 'EE'],
    LT: ['Литва', 'литва', 'Lithuania', 'LT'],
    LV: ['Латвія', 'латвія', 'Latvia', 'LV'],
    MD: ['Молдова', 'молдова', 'Moldova', 'MD'],
    TR: ['Туреччина', 'туреччина', 'Turkey', 'Türkiye', 'TR'],
    MK: ['Македонія', 'македонія', 'Macedonia', 'MK'],
    HR: ['Хорватія', 'хорватія', 'Croatia', 'HR'],
    SI: ['Словенія', 'словенія', 'Slovenia', 'SI'],
  };
  return map[code] || [];
}

// Обчислення винагороди
// Винагорода = client_freight - carrier_freight
// Якщо немає підтверджень з обома → винагорода 0
function computeReward({ formData, orderProgress }){
  if (!formData) return 0;
  // №9: винагорода — це РОЗРАХУНОК з вписаних сум, рахується ЗАВЖДИ.
  // Право на помилку: студент може вибрати не того перевізника / вписати суми —
  // винагорода все одно показується (cf - carF). Перевірка правильності (чи суми
  // збігаються з угодою, чи перевізник той) — ОКРЕМО, через session_deals при
  // зарахуванні в тотал. Тут НЕ обнуляємо.
  const cf = parseFloat(formData.client_freight) || 0;
  const carF = parseFloat(formData.carrier_freight) || 0;
  return Math.round((cf - carF) * 100) / 100;
}

module.exports = {
  validateApplication,
  computeReward,
};
