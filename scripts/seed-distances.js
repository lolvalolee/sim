// seed-distances.js — Деплой 19: заповнення dist_to_border / dist_after_border / border_name
// Дані з Симулятор_1_1.ods. Мапінг по маршруту (subject листа містить "Маршрут: X — Y").
// Запуск: node scripts/seed-distances.js
// Безпечно запускати повторно — оновлює лише листи де ще не заповнено.

const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'simulator.db');
const db = new Database(dbPath);

// Дані з ODS: маршрут, кордон (скорочено), км, до кордону, після кордону
const ROUTES = [
  { route: 'Сараєво (BA) — Дубно (UA)', border: 'Ужгород', km: 1310, toBorder: 917, afterBorder: 393 },
  { route: 'Луцьк (UA) — Манчестер (GB)', border: 'Ягодин', km: 2450, toBorder: 2313, afterBorder: 137 },
  { route: 'Осло (NO) — Хмельницький (UA)', border: 'Шегині', km: 2050, toBorder: 1726, afterBorder: 324 },
  { route: 'Черкаси (UA) — Брюге (BE)', border: 'Краківець', km: 2450, toBorder: 1654, afterBorder: 796 },
  { route: 'Трент (IT) + Удіне (IT) — Золочів (UA)', border: 'Чоп', km: 1450, toBorder: 1120, afterBorder: 330 },
  { route: 'Біла Церква (UA) — Рієка (HR)', border: 'Ужгород', km: 1300, toBorder: 520, afterBorder: 780 },
  { route: 'Ліон (FR) — Харків (UA)', border: 'Шегині', km: 3100, toBorder: 2003, afterBorder: 1097 },
  { route: 'Мукачево (UA) — Ессен (DE)', border: 'Краківець', km: 1400, toBorder: 1162, afterBorder: 238 },
  { route: 'Більбао (ES) — Володимир (UA)', border: 'Ужгород', km: 3200, toBorder: 2820, afterBorder: 380 },
  { route: 'Тисмениця (UA) — Скоп’є (MK)', border: 'Ужгород', km: 1250, toBorder: 281, afterBorder: 969 },
  { route: 'Дуррес (AL) — Одеса (UA)', border: 'Рені', km: 1700, toBorder: 1402, afterBorder: 298 },
  { route: 'Гайсин (UA) — Тімішоара (RO)', border: 'Порубне', km: 600, toBorder: 430, afterBorder: 170 },
  { route: 'Кошице (SK) — Шепетівка (UA)', border: 'Ужгород', km: 700, toBorder: 135, afterBorder: 565 },
  { route: 'Славута (UA) — Бірмінгем (GB)', border: 'Ягодин', km: 2700, toBorder: 420, afterBorder: 2280 },
  { route: 'Дебрецен (HU) — Прилуки (UA)', border: 'Чоп', km: 1050, toBorder: 225, afterBorder: 825 },
  { route: 'Лубни (UA) — Стакгольм (SE)', border: 'Ягодин', km: 2100, toBorder: 104, afterBorder: 1996 },
  { route: 'Пернік (BG) — Кропивницький (UA)', border: 'Чоп', km: 1250, toBorder: 434, afterBorder: 816 },
  { route: 'Звягель (UA) — Плзень (CZ)', border: 'Ужгород', km: 1230, toBorder: 583, afterBorder: 647 },
  { route: 'Інсбрук (AT) — Чернігів (UA)', border: 'Ужгород', km: 2100, toBorder: 1146, afterBorder: 954 },
  { route: 'Сарни (UA) — Хернінг (DK)', border: 'Ягодин', km: 1800, toBorder: 204, afterBorder: 1596 },
  { route: 'Зволле (NL) — Київ (UA)', border: 'Рава Руська', km: 2150, toBorder: 1447, afterBorder: 703 },
  { route: 'Коростень (UA) — Ченстохова (PL)', border: 'Краківець', km: 800, toBorder: 470, afterBorder: 330 },
  { route: 'Острава (CZ) — Львів + Рівне (UA)', border: 'Ужгород', km: 930, toBorder: 438, afterBorder: 492 },
  { route: 'Калуш (UA) — Сарагоса (ES)', border: 'Ужгород', km: 2860, toBorder: 241, afterBorder: 2619 },
  { route: 'Нант (FR) — Ірпінь (UA)', border: 'Шегині', km: 2790, toBorder: 2200, afterBorder: 590 },
  { route: 'Дрогобич (UA) — Авейру (PT)', border: 'Ужгород', km: 3520, toBorder: 212, afterBorder: 3298 },
  { route: 'Норрчепінг (SE) — Полтава (UA)', border: 'Шегині', km: 2115, toBorder: 1660, afterBorder: 455 },
  { route: 'Кривий Ріг — Вільнюс (LT)', border: 'Ягодин', km: 1400, toBorder: 924, afterBorder: 476 },
  { route: 'Івано Франківськ (UA) — Грац (AT)', border: 'Ужгород', km: 1050, toBorder: 270, afterBorder: 780 },
  { route: 'Салоніки (GR) — Дніпро (UA)', border: 'Порубне', km: 2135, toBorder: 930, afterBorder: 1215 },
  { route: 'Жмеринка (UA) — Люблін (PL)', border: 'Рава Руська', km: 705, toBorder: 404, afterBorder: 298 },
  { route: 'Ізмір (TR) — Надвірна (UA)', border: 'Порубне', km: 2000, toBorder: 1457, afterBorder: 543 },
  { route: 'Житомир (UA) — Аліканте (ES)', border: 'Ужгород', km: 3400, toBorder: 637, afterBorder: 2763 },
  { route: 'Оснабрюк (DE) — Костопіль (UA)', border: 'Ягодин', km: 1650, toBorder: 1337, afterBorder: 313 },
  { route: 'Стрий (UA) — Софія (BG)', border: 'Порубне', km: 1109, toBorder: 276, afterBorder: 833 },
  { route: 'Кишинів (MD) — Гадяч (UA)', border: 'Дяково', km: 850, toBorder: 709, afterBorder: 141 },
  { route: 'Надвірна (UA) — Жари (PL)', border: 'Ягодин', km: 907, toBorder: 375, afterBorder: 532 },
  { route: 'Лозанна (CH) — Бердичів (UA)', border: 'Ужгород', km: 2200, toBorder: 1546, afterBorder: 654 },
  { route: 'Чернівці (UA) — Севілья (ES)', border: 'Чоп', km: 3710, toBorder: 408, afterBorder: 3302 },
  { route: 'Клайпеда (LT) — Івано Франківськ (UA)', border: 'Ягодин', km: 1300, toBorder: 979, afterBorder: 321 },
  { route: 'Львів (UA) — Пассау (DE)', border: 'Краківець', km: 1050, toBorder: 205, afterBorder: 800 },
  { route: 'Тарту (EE) — Бориспіль (UA)', border: 'Ягодин', km: 1500, toBorder: 1274, afterBorder: 226 },
  { route: 'Козятин (UA) — Сомбатхей (HU)', border: 'Чоп', km: 900, toBorder: 647, afterBorder: 253 },
  { route: 'Вентспілс (LV) — Коломия (UA)', border: 'Рава Руська', km: 1540, toBorder: 1118, afterBorder: 422 },
  { route: 'Канів (UA) — Гетеборг (DK)', border: 'Ягодин', km: 2100, toBorder: 640, afterBorder: 1460 },
  { route: 'Анкара (TR) — Конотоп (UA)', border: 'Порубне', km: 2000, toBorder: 1765, afterBorder: 235 },
  { route: 'Ніжин (UA) — Білосток (PL)', border: 'Шегині', km: 900, toBorder: 771, afterBorder: 129 },
  { route: 'Норвіч (GB) — Шептицький (UA)', border: 'Ягодин', km: 2800, toBorder: 2174, afterBorder: 626 },
  { route: 'Золочів (UA) — Усті над Лабем (CZ)', border: 'Ужгород', km: 1050, toBorder: 328, afterBorder: 722 },
  { route: 'Любляна (SI) — Харків (UA)', border: 'Чоп', km: 1930, toBorder: 791, afterBorder: 1139 },
  { route: 'Тернопіль (UA) — Кечкемет (HU)', border: 'Чоп', km: 750, toBorder: 352, afterBorder: 398 },
  { route: 'Конья (TR) — Фастів (UA)', border: 'Порубне', km: 2400, toBorder: 1350, afterBorder: 1050 },
  { route: 'Коломия (UA) — Новий Сонч (PL)', border: 'Краківець', km: 350, toBorder: 268, afterBorder: 82 },
  { route: 'Анкона (IT) — Подільськ (UA)', border: 'Чоп', km: 1900, toBorder: 1381, afterBorder: 519 },
  { route: 'Хмільник (UA) — Братислава (SK)', border: 'Ужгород', km: 1000, toBorder: 561, afterBorder: 439 },
  { route: 'Рига (LV) — Гостомель (UA)', border: 'Ягодин', km: 1240, toBorder: 814, afterBorder: 426 },
  { route: 'Ратне (UA) — Антверпен (BE)', border: 'Краківець', km: 1930, toBorder: 274, afterBorder: 1656 },
  { route: 'Жерона (ES) — Обухів (UA)', border: 'Чоп', km: 3042, toBorder: 2154, afterBorder: 888 },
  { route: 'Радехів (UA) — Ганновер (DE)', border: 'Рава Руська', km: 1410, toBorder: 202, afterBorder: 1208 },
  { route: 'Хаапсалу (EE) — Бучач (UA)', border: 'Ягодин', km: 1680, toBorder: 1320, afterBorder: 360 },
  { route: 'Суми (UA) — Краків (PL)', border: 'Шегині', km: 1250, toBorder: 954, afterBorder: 296 },
  { route: 'Люцерн (CH) — Золочів (UA)', border: 'Чоп', km: 2000, toBorder: 1358, afterBorder: 642 },
  { route: 'Бурштин (UA) — Баликесір (TR)', border: 'Порубне', km: 1900, toBorder: 180, afterBorder: 1720 },
  { route: 'Барі (IT) — Жашків (UA)', border: 'Чоп', km: 2074, toBorder: 1699, afterBorder: 375 },
  { route: 'Золотоноша (UA) — Коувола (FI)', border: 'Ягодин', km: 1932, toBorder: 661, afterBorder: 1271 },
  { route: 'Мадрид (ES) — Яворів (UA)', border: 'Чоп', km: 3200, toBorder: 2854, afterBorder: 346 },
  { route: 'Тлумач (UA) — Білефельд (DE)', border: 'Шегині', km: 1600, toBorder: 236, afterBorder: 1364 },
  { route: 'Верона (IT) — Острог (UA)', border: 'Чоп', km: 1600, toBorder: 1139, afterBorder: 461 },
  { route: 'Городенка (UA) — Бидгощ (PL)', border: 'Рава Руська', km: 850, toBorder: 269, afterBorder: 581 },
  { route: 'Ейндховен (NL) — Ужгород (UA)', border: 'Чоп', km: 1700, toBorder: 1618, afterBorder: 82 },
  { route: 'Шостка (UA) — Берген (NO)', border: 'Ягодин', km: 2800, toBorder: 805, afterBorder: 1995 },
  { route: 'Дублін (IR) — Мукачево (UA)', border: 'Краківець', km: 3100, toBorder: 2511, afterBorder: 589 },
  { route: 'Київ (UA) — Утена (LT)', border: 'Ягодин', km: 904, toBorder: 508, afterBorder: 396 },
  { route: 'Марібор (SI) — Яремче (UA)', border: 'Чоп', km: 1200, toBorder: 670, afterBorder: 530 },
  { route: 'Гайворон (UA) — Сент Галлен (CH)', border: 'Ужгород', km: 2230, toBorder: 774, afterBorder: 1456 },
  { route: 'Франкфурт на Майні (DE) — Стрий (UA)', border: 'Краківець', km: 1580, toBorder: 1235, afterBorder: 345 },
  { route: 'Узин (UA) — Афіни (GR)', border: 'Порубне', km: 2200, toBorder: 524, afterBorder: 1676 },
  { route: 'Трнава (SK) — Рокитне (UA)', border: 'Ужгород', km: 900, toBorder: 481, afterBorder: 419 },
  { route: 'Снятин (UA) — Діжон (FR)', border: 'Шегині', km: 1900, toBorder: 298, afterBorder: 1602 },
  { route: 'Брага (PT) — Бориспіль (UA)', border: 'Чоп', km: 3500, toBorder: 3220, afterBorder: 280 },
  { route: 'Староконстантинів (UA) — Елк (PL)', border: 'Рава Руська', km: 750, toBorder: 335, afterBorder: 415 },
  { route: 'Клуж Напока (RO) — Пісочин (UA)', border: 'Порубне', km: 1400, toBorder: 300, afterBorder: 1100 },
  { route: 'Глобине (UA) — Халкіда (GR)', border: 'Порубне', km: 2000, toBorder: 890, afterBorder: 1110 },
  { route: 'Неаполь (IT) — Тростянець (UA)', border: 'Чоп', km: 2200, toBorder: 1743, afterBorder: 457 },
  { route: 'Малехів (UA) — Лейпціг (DE)', border: 'Краківець', km: 1100, toBorder: 75, afterBorder: 1025 },
  { route: 'Амерсфоорт (NL) — Крижопіль (UA)', border: 'Шегині', km: 2100, toBorder: 1434, afterBorder: 266 },
  { route: 'Городок (UA) — Страсбург (FR)', border: 'Шегині', km: 1700, toBorder: 52, afterBorder: 1648 },
  { route: 'Кіріккале (TR) — Тульчин (UA)', border: 'Порубне', km: 2000, toBorder: 1845, afterBorder: 155 },
  { route: 'Сокаль (UA) — Варшава (PL)', border: 'Рава Руська', km: 450, toBorder: 74, afterBorder: 376 },
  { route: 'Айзенах (DE) — Житомир (UA)', border: 'Шегині', km: 1700, toBorder: 1045, afterBorder: 655 },
  { route: 'Вінниця (UA) — Утрехт (NL)', border: 'Краківець', km: 2100, toBorder: 442, afterBorder: 1658 },
  { route: 'Стара Загора (SK) — Рівне (UA)', border: 'Ужгород', km: 1400, toBorder: 1318, afterBorder: 82 },
  { route: 'Костопіль (UA) — Генк (BE)', border: 'Шегині', km: 1900, toBorder: 333, afterBorder: 1567 },
  { route: 'Радом (PL) — Калуш (UA)', border: 'Рава Руська', km: 650, toBorder: 272, afterBorder: 378 },
  { route: 'Одеса (UA) — Провадія (BG)', border: 'Порубне', km: 850, toBorder: 360, afterBorder: 490 },
  { route: 'Брегенц (AT) — Чернігів (UA)', border: 'Чоп', km: 2200, toBorder: 1177, afterBorder: 1023 },
  { route: 'Долина (UA) — Стамбул (TR)', border: 'Порубне', km: 1600, toBorder: 205, afterBorder: 1395 },
  { route: 'Марсель (FR) — Верховина (UA)', border: 'Шегині', km: 2400, toBorder: 2049, afterBorder: 351 },
  { route: 'Малин (UA) — Сомбатхей (HU)', border: 'Чоп', km: 1050, toBorder: 728, afterBorder: 322 },
  { route: 'Брюссель (BE) — Клевань (UA)', border: 'Краківець', km: 2000, toBorder: 1555, afterBorder: 445 },
  { route: 'Гусятин (UA) — Єнчепінг (SE)', border: 'Ягодин', km: 1900, toBorder: 351, afterBorder: 1549 },
  { route: 'Прага (CZ) — Кропивницький (UA)', border: 'Ужгород', km: 1700, toBorder: 735, afterBorder: 965 },
  { route: 'Клевань (UA) — Зальцбург (AT)', border: 'Чоп', km: 1300, toBorder: 476, afterBorder: 824 },
  { route: 'Фехта (DE) — Турійськ (UA)', border: 'Краківець', km: 1700, toBorder: 1265, afterBorder: 435 },
  { route: 'Славутич (UA) — Рим (IT)', border: 'Чоп', km: 2400, toBorder: 966, afterBorder: 1434 },
  { route: 'Галац (RO) — Одеса (UA)', border: 'Порубне', km: 750, toBorder: 360, afterBorder: 390 },
  { route: 'Красилів (UA) — Осло (NO)', border: 'Ягодин', km: 2400, toBorder: 369, afterBorder: 2031 },
  { route: 'Толедо (ES) — Тернопіль (UA)', border: 'Ужгород', km: 3200, toBorder: 2938, afterBorder: 262 },
  { route: 'Луцьк (UA) — Щецин (PL)', border: 'Ягодин', km: 950, toBorder: 137, afterBorder: 813 },
  { route: 'Росток (DE) — Городок (UA)', border: 'Шегині', km: 1700, toBorder: 1085, afterBorder: 615 },
  { route: 'Шепетівка (UA) — Болонья (IT)', border: 'Чоп', km: 1700, toBorder: 567, afterBorder: 1133 },
  { route: 'Пловдів (BG) — Львів (UA)', border: 'Порубне', km: 1200, toBorder: 780, afterBorder: 420 },
  { route: 'Бровари (UA) — Плоешті (RO)', border: 'Порубне', km: 850, toBorder: 610, afterBorder: 240 },
  { route: 'Вінер-Нойштадт (AT) — Узин (UA)', border: 'Чоп', km: 1100, toBorder: 592, afterBorder: 508 },
  { route: 'Чернігів (UA) — Флоренція (IT)', border: 'Чоп', km: 2300, toBorder: 956, afterBorder: 1344 },
  { route: 'Париж (FR) — Львів (UA)', border: 'Краківець', km: 1900, toBorder: 1796, afterBorder: 104 },
  { route: 'Житомир (UA) — Шяуляй (LT)', border: 'Ягодин', km: 1100, toBorder: 395, afterBorder: 705 },
  { route: 'Бидгощ (PL) — Прилуки (UA)', border: 'Краківець', km: 1400, toBorder: 711, afterBorder: 689 },
  { route: 'Тернопіль (UA) — Оньї (FR)', border: 'Шегині', km: 2200, toBorder: 211, afterBorder: 1989 },
  { route: 'Ескішехір (TR) — Кривий Ріг (UA)', border: 'Порубне', km: 2100, toBorder: 1450, afterBorder: 650 },];

// Нормалізація маршруту для порівняння: прибираємо пробіли, ' + ' тощо
function normRoute(s) {
  return (s || '')
    .replace(/\s+/g, '')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .toLowerCase();
}

// Витягуємо маршрут з subject або body листа
function extractRoute(letter) {
  const text = (letter.subject || '') + ' ' + (letter.body || '');
  const m = text.match(/Маршрут:\s*([^\n]+)/);
  if (m) return m[1].trim();
  // fallback: subject "...: A — B"
  const m2 = (letter.subject || '').match(/:\s*(.+)$/);
  if (m2) return m2[1].trim();
  return '';
}

const letters = db.prepare('SELECT id, subject, body, dist_to_border FROM letters').all();
console.log(`[seed-distances] Листів у БД: ${letters.length}`);

// Будуємо мапу нормалізований_маршрут → дані
const routeMap = {};
for (const r of ROUTES) {
  routeMap[normRoute(r.route)] = r;
}

const upd = db.prepare(`
  UPDATE letters SET dist_to_border=?, dist_after_border=?, border_name=? WHERE id=?
`);

let matched = 0, missed = 0;
const missList = [];
const tx = db.transaction(() => {
  for (const letter of letters) {
    const route = extractRoute(letter);
    const key = normRoute(route);
    const data = routeMap[key];
    if (data) {
      upd.run(data.toBorder, data.afterBorder, data.border, letter.id);
      matched++;
    } else {
      missed++;
      if (missList.length < 15) missList.push(route || '(порожній маршрут)');
    }
  }
});
tx();

console.log(`[seed-distances] ✓ Заповнено: ${matched}, не знайдено: ${missed}`);
if (missList.length) {
  console.log('[seed-distances] Не знайдені маршрути (перші 15):');
  missList.forEach(r => console.log('   -', r));
}

db.close();
console.log('[seed-distances] Готово.\n');
